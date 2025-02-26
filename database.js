const mysql = require('mysql2')
const mysql2 = require('mysql2/promise')
const fs = require('fs')
const path = require('path')
require('dotenv').config()

// Mở ca.pem
const caCertPath = path.join(__dirname, './ca.pem')

// Đọc nội dung file ca.pem
const caCert = fs.readFileSync(caCertPath)

// Tạo kết nối đến database
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    ca: caCert
  },
})

const connectDB = async () => {
  // Mở kết nối MySQL
  connection.connect((error) => {
    if (error) {
      console.error('Lỗi kết nối MySQL: ' + error.stack)
      return
    }
    console.log('Kết nối thành công đến MySQL với ID luồng ' + connection.threadId)
  })
  await connection.end()
}
connectDB()

// Tạo pool
const pool = mysql2.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 30000,
  queueLimit: 0,
  ssl: {
    ca: caCert
  },
})

module.exports = pool
