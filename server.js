// Code generated by ChatGPT o3 mini

require('dotenv').config()
const express = require('express')
const ExcelJS = require('exceljs')
const zlib = require('zlib')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const pool = require('./database')

const app = express()
const port = process.env.SERVER_PORT || 5000

// Middleware
app.use(cors())
app.use(express.json())

// Middleware kiểm tra JWT cho các API cần bảo vệ
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization']
  // Token thường có định dạng "Bearer <token>"
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) return res.status(401).json({ error: 'Access token missing' })

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid access token' })
    req.user = user
    next()
  })
}

// ==================================
// API Auth: Signup và Login
// ==================================

// API đăng ký người dùng
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, password } = req.body

    // Kiểm tra các trường bắt buộc
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' })
    }

    // Kiểm tra xem username đã tồn tại chưa
    const [existing] = await pool.query('SELECT * FROM users WHERE username = ?', [username])
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Username already exists' })
    }

    // Mã hóa password
    const saltRounds = 10
    const hashedPassword = await bcrypt.hash(password, saltRounds)

    // Thêm người dùng vào cơ sở dữ liệu (bạn cần có bảng users với các trường id, username, password)
    const [result] = await pool.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword])

    res.status(201).json({ message: 'User registered successfully', userId: result.insertId })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// API đăng nhập
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body

    // Kiểm tra các trường bắt buộc
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' })
    }

    // Lấy thông tin user từ DB
    const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username])
    if (users.length === 0) {
      return res.status(400).json({ error: 'Invalid credentials' })
    }
    const user = users[0]

    // So sánh password
    const validPassword = await bcrypt.compare(password, user.password)
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' })
    }

    // Kiểm tra biến môi trường JWT_SECRET và JWT_EXPIRATION
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not defined')
      return res.status(500).json({ error: 'Internal server error' })
    }
    // Sử dụng JWT_EXPIRATION nếu có, nếu không thì mặc định là 1h
    const jwtExpiration = process.env.JWT_EXPIRATION || '30s'

    // Tạo JWT (bao gồm thông tin cơ bản của user, ví dụ id, username)
    const tokenPayload = { id: user.id, username: user.username }
    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: jwtExpiration })

    res.json({ message: 'Login successful', token })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ==================================
// Các API game (CRUD) bảo vệ bởi middleware xác thực
// ==================================

// API lấy danh sách game với tìm kiếm full text, lọc và phân trang kèm thông tin metadata
app.get('/api/games', authenticateToken, async (req, res) => {
  try {
    const { search, genre, platform, min_rating, max_rating, min_year, max_year, page = 1, limit = 20 } = req.query

    const currentPage = parseInt(page, 10)
    let perPage = parseInt(limit, 10)
    const noLimit = perPage === 0

    // 1. Lấy tổng số game trong database
    const [totalResult] = await pool.query('SELECT COUNT(*) AS total FROM games')
    const totalItems = totalResult[0].total

    // 2. Xây dựng điều kiện lọc
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

    // 3. Đếm số lượng game sau khi lọc
    const filteredCountQuery = `SELECT COUNT(*) AS total FROM games WHERE 1=1 ${queryConditions}`
    const [filteredCountResult] = await pool.query(filteredCountQuery, paramsConditions)
    const filteredTotalItems = filteredCountResult[0].total

    // 4. Truy vấn dữ liệu
    let dataQuery = `SELECT * FROM games WHERE 1=1 ${queryConditions}`
    const dataParams = [...paramsConditions]

    if (!noLimit) {
      const offset = (currentPage - 1) * perPage
      dataQuery += ' LIMIT ? OFFSET ?'
      dataParams.push(perPage, offset)
    }

    const [games] = await pool.query(dataQuery, dataParams)

    // 5. Tính tổng số trang sau khi lọc (chỉ tính nếu có phân trang)
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

// GET /api/games/:id - Lấy thông tin một game theo ID
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

// POST /api/games - Tạo game mới
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

// PUT /api/games/:id - Cập nhật thông tin game theo ID
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

// DELETE /api/games - Xóa game theo mảng id được truyền qua body
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

// API export game sang file Excel
app.get('/api/games/export/excel', authenticateToken, async (req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename=games.xlsx')

  let connection
  try {
    const acceptEncoding = req.headers['accept-encoding'] || ''
    const useCompression = acceptEncoding.includes('gzip')
    let outputStream = res

    if (useCompression) {
      res.setHeader('Content-Encoding', 'gzip')
      const gzip = zlib.createGzip()
      outputStream = gzip
      gzip.pipe(res)
    }

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: outputStream,
      useStyles: false,
      useSharedStrings: false,
      bufferSize: 8192,
    })

    const worksheet = workbook.addWorksheet('Games')
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Genre', key: 'genre', width: 20 },
      { header: 'Platform', key: 'platform', width: 20 },
      { header: 'Rating', key: 'rating', width: 10 },
      { header: 'Release Year', key: 'release_year', width: 15 },
      { header: 'Description', key: 'description', width: 50 },
    ]

    connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        err ? reject(err) : resolve(conn)
      })
    })

    const query = 'SELECT id, name, genre, platform, rating, release_year, description FROM games'
    const queryStream = connection.query(query).stream({
      highWaterMark: 10000,
      sql: query,
      typeCast: (field, next) => (field.type === 'DATE' ? field.string() : next()),
    })

    let buffer = []
    const BATCH_SIZE = 5000

    const processBatch = () => {
      if (buffer.length > 0) {
        buffer.forEach((row) => worksheet.addRow(row).commit())
        buffer = []
      }
    }

    const batchInterval = setInterval(processBatch, 1000)

    queryStream.on('data', (row) => {
      buffer.push(row)
      if (buffer.length >= BATCH_SIZE) processBatch()

      if (!outputStream.write('')) {
        queryStream.pause()
        outputStream.once('drain', () => queryStream.resume())
      }
    })

    queryStream.on('end', async () => {
      clearInterval(batchInterval)
      processBatch()
      worksheet.commit()

      try {
        await workbook.commit()
        if (useCompression) outputStream.end()
        connection.release()
      } catch (error) {
        console.error('Commit error:', error)
        connection.release()
        res.status(500).end()
      }
    })

    queryStream.on('error', (error) => {
      clearInterval(batchInterval)
      console.error('Stream error:', error)
      connection.release()
      if (!res.headersSent) res.status(500).end()
    })
  } catch (error) {
    console.error('Initialization error:', error)
    if (connection) connection.release()
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' })
  }
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
