require('dotenv').config()
const express = require('express')
const cors = require('cors')
const pool = require('./database')

const app = express()
const port = process.env.SERVER_PORT || 5000

// Middleware
app.use(cors())
app.use(express.json())

// API lấy danh sách game với tìm kiếm full text, lọc và phân trang kèm thông tin metadata
app.get('/api/games', async (req, res) => {
  try {
    // Lấy các query params, nếu không truyền sẽ dùng giá trị mặc định
    const { search, genre, platform, min_rating, max_rating, min_year, max_year, page = 1, limit = 20 } = req.query

    // Chuyển đổi page và limit về số nguyên
    const currentPage = parseInt(page, 10)
    const perPage = parseInt(limit, 10)

    // 1. Lấy tổng số items trong bảng (không lọc)
    const [totalResult] = await pool.query('SELECT COUNT(*) AS total FROM games')
    const totalItems = totalResult[0].total

    // 2. Xây dựng điều kiện lọc dùng chung cho count (sau khi lọc) và truy vấn dữ liệu
    let queryConditions = ''
    const paramsConditions = []

    // Sử dụng full text search nếu có tham số search
    if (search) {
      queryConditions += ' AND MATCH(name) AGAINST(? IN BOOLEAN MODE)'
      // Sử dụng cú pháp boolean search với dấu + và wildcard *
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

    // 3. Lấy tổng số items sau khi áp dụng các điều kiện lọc
    const filteredCountQuery = `SELECT COUNT(*) AS total FROM games WHERE 1=1 ${queryConditions}`
    const [filteredCountResult] = await pool.query(filteredCountQuery, paramsConditions)
    const filteredTotalItems = filteredCountResult[0].total

    // 4. Tính offset cho phân trang
    const offset = (currentPage - 1) * perPage

    // 5. Truy vấn dữ liệu game sau khi áp dụng điều kiện lọc và phân trang
    const dataQuery = `SELECT * FROM games WHERE 1=1 ${queryConditions} LIMIT ? OFFSET ?`
    const dataParams = [...paramsConditions, perPage, offset]
    const [games] = await pool.query(dataQuery, dataParams)

    // 6. Tính tổng số trang sau khi lọc
    const totalPages = Math.ceil(filteredTotalItems / perPage)

    // 7. Trả về dữ liệu kèm metadata
    res.json({
      current_page: currentPage,
      limit: perPage,
      total_items: totalItems, // Tổng items trong bảng (không lọc)
      filtered_items: filteredTotalItems, // Tổng items sau khi lọc
      total_pages: totalPages, // Tổng số trang sau khi lọc
      data: games,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================
// GET /api/games/:id - Lấy thông tin một game theo ID
// ============================
app.get('/api/games/:id', async (req, res) => {
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

// ============================
// POST /api/games/ - Tạo game mới
// ============================
app.post('/api/games', async (req, res) => {
  try {
    const { name, genre, platform, rating, release_year, price } = req.body

    // Kiểm tra trường bắt buộc
    if (!name) {
      return res.status(400).json({ error: 'Name is required' })
    }

    // Kiểm tra xem game có tên trùng nhau không
    const [existing] = await pool.query('SELECT * FROM games WHERE name = ?', [name])
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Game with this name already exists' })
    }

    // Thực hiện chèn game mới
    const [result] = await pool.query('INSERT INTO games (name, genre, platform, rating, release_year, price) VALUES (?, ?, ?, ?, ?, ?)', [
      name,
      genre,
      platform,
      rating,
      release_year,
      price,
    ])
    const insertedId = result.insertId

    // Truy vấn game vừa được thêm
    const [newGame] = await pool.query('SELECT * FROM games WHERE id = ?', [insertedId])
    res.status(201).json(newGame[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================
// PUT /api/games/:id - Cập nhật thông tin game theo ID
// ============================
app.put('/api/games/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { name, genre, platform, rating, release_year, price } = req.body

    // Kiểm tra xem game có tồn tại không
    const [existing] = await pool.query('SELECT * FROM games WHERE id = ?', [id])
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Game not found' })
    }

    // Cập nhật game (bạn có thể kiểm tra từng trường nếu cần thiết)
    await pool.query('UPDATE games SET name = ?, genre = ?, platform = ?, rating = ?, release_year = ?, price = ? WHERE id = ?', [
      name,
      genre,
      platform,
      rating,
      release_year,
      price,
      id,
    ])

    // Lấy dữ liệu game đã cập nhật
    const [updated] = await pool.query('SELECT * FROM games WHERE id = ?', [id])
    res.json(updated[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================
// DELETE /api/games/:id - Xóa game theo ID
// ============================
app.delete('/api/games', async (req, res) => {
  try {
    const { ids } = req.body

    // Kiểm tra xem ids có phải là mảng không và không rỗng
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Ids must be a non-empty array' })
    }

    // Thực hiện xoá các game có id nằm trong mảng ids
    const [result] = await pool.query('DELETE FROM games WHERE id IN (?)', [ids])

    // Nếu không có bản ghi nào bị xoá, trả về lỗi 404
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
