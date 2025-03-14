// Code generated by ChatGPT o3 mini
require('dotenv').config()
const express = require('express')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const pool = require('./database')
const cors = require('cors')
const crypto = require('crypto')

const app = express()
const port = process.env.SERVER_PORT || 5000

const corsOptions = {
  origin: ['*', process.env.URI_CLIENT],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
app.use(express.json())

// Lưu trữ phiên: mapping sessionId -> refreshToken và userId -> sessionId (1 phiên cho 1 user)
let sessionStore = {} // { sessionId: refreshToken }
let userSessionMapping = {} // { userId: sessionId }

// Middleware kiểm tra JWT (dành cho access token)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Access token missing' })

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: 'Invalid access token' })
    req.user = user
    next()
  })
}

// ==================================
// API Auth: Signup, Login, Refresh và Logout
// ==================================

// API đăng ký người dùng
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' })
    }
    const [existing] = await pool.query('SELECT * FROM users WHERE username = ?', [username])
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Username already exists' })
    }
    const saltRounds = 10
    const hashedPassword = await bcrypt.hash(password, saltRounds)
    const [result] = await pool.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword])
    res.status(201).json({ message: 'User registered successfully', userId: result.insertId })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// API đăng nhập: tạo access token và refresh token (lưu refresh token bên server, trả session id cho client)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' })
    }

    const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username])
    if (users.length === 0) {
      return res.status(400).json({ error: 'Invalid credentials' })
    }

    const user = users[0]
    const validPassword = await bcrypt.compare(password, user.password)
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' })
    }

    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not defined')
      return res.status(500).json({ error: 'Internal server error' })
    }

    const accessTokenExpiry = process.env.JWT_EXPIRATION || '1h'
    const refreshTokenExpiry = process.env.JWT_REFRESH_EXPIRATION || '7d'

    // Tạo access token với payload thông tin user
    const accessPayload = { id: user.id, username: user.username, tokenType: 'access' }
    const accessToken = jwt.sign(accessPayload, process.env.JWT_SECRET, { expiresIn: accessTokenExpiry })

    // Tạo refresh token (không gửi cho client, chỉ lưu bên server)
    const refreshPayload = { id: user.id, username: user.username, tokenType: 'refresh' }
    const refreshToken = jwt.sign(refreshPayload, process.env.JWT_SECRET, { expiresIn: refreshTokenExpiry })

    // Tạo session id (ví dụ sử dụng crypto để tạo chuỗi ngẫu nhiên)
    const sessionId = crypto.randomBytes(16).toString('hex')

    // Lưu refresh token theo session id và mapping user id -> session id
    sessionStore[sessionId] = refreshToken
    userSessionMapping[user.id] = sessionId

    // Trả về access token (không trả refresh token hay session id trong login)
    res.json({ message: 'Login successful', accessToken, sessionId })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// API checkAuth: trả về session id nếu phiên tồn tại
app.get('/api/auth/checkAuth', authenticateToken, (req, res) => {
  const userId = req.user.id
  const sessionId = userSessionMapping[userId] || null

  res.json({
    isAuthenticated: !!sessionId,
    user: req.user,
    sessionId,
  })
})

// API refresh: sử dụng session id để cấp access token mới
app.post('/api/auth/refresh', (req, res) => {
  const { sessionId } = req.body
  if (!sessionId) {
    return res.status(401).json({ error: 'Session ID missing' })
  }

  const refreshToken = sessionStore[sessionId]
  if (!refreshToken) {
    return res.status(403).json({ error: 'Invalid session ID' })
  }

  jwt.verify(refreshToken, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      // Nếu token hết hạn, trả về 401 Unauthorized
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'invalid_grant',
          error_description: 'Refresh token has expired'
        })
      }
      // Các lỗi khác cũng trả về 403 Forbidden
      return res.status(403).json({ error: 'Invalid refresh token' })
    }

    if (user.tokenType !== 'refresh') {
      return res.status(403).json({ error: 'Invalid token type' })
    }

    const accessPayload = {
      id: user.id,
      username: user.username,
      tokenType: 'access'
    }
    const accessTokenExpiry = process.env.JWT_EXPIRATION || '1h'
    const newAccessToken = jwt.sign(accessPayload, process.env.JWT_SECRET, {
      expiresIn: accessTokenExpiry
    })
    res.json({ accessToken: newAccessToken })
  })
})

// API logout: sử dụng session id để hủy phiên
app.post('/api/auth/logout', (req, res) => {
  const { sessionId } = req.body // Lấy sessionId từ body
  if (!sessionId) return res.status(400).json({ error: 'Session ID missing' })

  // Xóa phiên khỏi sessionStore và mapping user
  const refreshToken = sessionStore[sessionId]
  if (refreshToken) {
    // Tìm user có session này để xóa mapping
    jwt.verify(refreshToken, process.env.JWT_SECRET, (err, user) => {
      if (!err && user && user.id) {
        delete userSessionMapping[user.id]
      }
    })
    delete sessionStore[sessionId]
  }
  res.json({ message: 'Logout successful' })
})

// ==================================
// Các API game (CRUD) bảo vệ bởi middleware xác thực
// ==================================

// API lấy danh sách game
app.get('/api/games', authenticateToken, async (req, res) => {
  try {
    const { search, genre, platform, min_rating, max_rating, min_year, max_year, page = 1, limit = 20 } = req.query
    const currentPage = parseInt(page, 10)
    let perPage = parseInt(limit, 10)
    const noLimit = perPage === 0
    const [totalResult] = await pool.query('SELECT COUNT(*) AS total FROM games')
    const totalItems = totalResult[0].total
    let queryConditions = ''
    const paramsConditions = []
    if (search) {
      queryConditions += ' AND MATCH(name) AGAINST(? IN BOOLEAN MODE)'
      paramsConditions.push(`+${search}*`)
    }
    if (genre) {
      queryConditions += ' AND genre = ?'
      paramsConditions.push(genre)
    }
    if (platform) {
      queryConditions += ' AND platform = ?'
      paramsConditions.push(platform)
    }
    if (min_rating) {
      queryConditions += ' AND rating >= ?'
      paramsConditions.push(parseFloat(min_rating))
    }
    if (max_rating) {
      queryConditions += ' AND rating <= ?'
      paramsConditions.push(parseFloat(max_rating))
    }
    if (min_year) {
      queryConditions += ' AND release_year >= ?'
      paramsConditions.push(parseInt(min_year, 10))
    }
    if (max_year) {
      queryConditions += ' AND release_year <= ?'
      paramsConditions.push(parseInt(max_year, 10))
    }
    const filteredCountQuery = `SELECT COUNT(*) AS total FROM games WHERE 1=1 ${queryConditions}`
    const [filteredCountResult] = await pool.query(filteredCountQuery, paramsConditions)
    const filteredTotalItems = filteredCountResult[0].total
    let dataQuery = `SELECT * FROM games WHERE 1=1 ${queryConditions}`
    const dataParams = [...paramsConditions]
    if (!noLimit) {
      const offset = (currentPage - 1) * perPage
      dataQuery += ' LIMIT ? OFFSET ?'
      dataParams.push(perPage, offset)
    }
    const [games] = await pool.query(dataQuery, dataParams)
    const totalPages = noLimit ? 1 : Math.ceil(filteredTotalItems / perPage)
    res.json({
      current_page: noLimit ? null : currentPage,
      limit: noLimit ? null : perPage,
      total_items: totalItems,
      filtered_items: filteredTotalItems,
      total_pages: noLimit ? null : totalPages,
      data: games,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Các API game khác (GET theo id, POST, PUT, DELETE) giữ nguyên logic và được bảo vệ bởi middleware authenticateToken

app.get('/api/games/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const [result] = await pool.query('SELECT * FROM games WHERE id = ?', [id])
    if (result.length === 0) {
      return res.status(404).json({ error: 'Game not found' })
    }
    res.json(result[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/games', authenticateToken, async (req, res) => {
  try {
    const { name, genre, platform, rating, release_year, price } = req.body
    if (!name) {
      return res.status(400).json({ error: 'Name is required' })
    }
    const [existing] = await pool.query('SELECT * FROM games WHERE name = ?', [name])
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Game with this name already exists' })
    }
    const [result] = await pool.query('INSERT INTO games (name, genre, platform, rating, release_year, price) VALUES (?, ?, ?, ?, ?, ?)', [
      name,
      genre,
      platform,
      rating,
      release_year,
      price,
    ])
    const insertedId = result.insertId
    const [newGame] = await pool.query('SELECT * FROM games WHERE id = ?', [insertedId])
    res.status(201).json(newGame[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.put('/api/games/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { name, genre, platform, rating, release_year, price } = req.body
    const [existing] = await pool.query('SELECT * FROM games WHERE id = ?', [id])
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Game not found' })
    }
    await pool.query('UPDATE games SET name = ?, genre = ?, platform = ?, rating = ?, release_year = ?, price = ? WHERE id = ?', [
      name,
      genre,
      platform,
      rating,
      release_year,
      price,
      id,
    ])
    const [updated] = await pool.query('SELECT * FROM games WHERE id = ?', [id])
    res.json(updated[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.delete('/api/games', authenticateToken, async (req, res) => {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Ids must be a non-empty array' })
    }
    const [result] = await pool.query('DELETE FROM games WHERE id IN (?)', [ids])
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'No game found for the provided Ids' })
    }
    res.json({ message: 'Games deleted successfully', affectedRows: result.affectedRows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
