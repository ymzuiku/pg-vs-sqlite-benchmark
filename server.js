const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json());

const DB_ROWS = 5 * 10000; // 总行数示例

// 确保 data 目录存在
if (!fs.existsSync("data")) fs.mkdirSync("data");

/**
 * 生成模拟用户数据
 */
function generateMockUser(index) {
  const safeIndex = Number(index) % 10000000; // 防止溢出
  const uniqueSuffix = `${safeIndex}_${Date.now()}_${Math.random()}`; // 确保唯一

  return [
    `user_${uniqueSuffix}`,
    `user_${uniqueSuffix}@example.com`,
    20 + (index % 40),
    ["male", "female", "other"][index % 3],
    index % 2 === 0 ? 1 : 0,
    index % 1000,
    (index % 100) + Math.random(),
    ["US", "CA", "UK", "DE", "JP"][index % 5],
    ["active", "inactive", "banned"][index % 3],
    new Date(Date.now() - (safeIndex % 3650) * 86400000).toISOString(),
    new Date(Date.now() - (safeIndex % 365) * 86400000).toISOString(),
    JSON.stringify({ theme: "dark" }),
    JSON.stringify({ lang: "en" }),
    ...Array.from({ length: 16 }, (_, i) => `field${i + 1}_${index}`),
  ];
}

/**
 * 生成模拟订单数据
 */
function generateMockOrder(index) {
  const safeIndex = Number(index) % 10000000;
  const uniqueSuffix = `${safeIndex}_${Date.now()}_${Math.random()}`;

  return [
    `order_${uniqueSuffix}`,
    index % 100, // 将 user_id 的范围缩小到 0-99，这样每个用户会有 3000 个订单 (300000/100 = 3000)
    ["pending", "completed", "cancelled"][index % 3],
    (index % 1000) + Math.random() * 100,
    new Date(Date.now() - (safeIndex % 365) * 86400000).toISOString(),
    new Date(Date.now() - (safeIndex % 30) * 86400000).toISOString(),
    JSON.stringify({ payment: "credit_card" }),
    ...Array.from({ length: 16 }, (_, i) => `field${i + 1}_${index}`),
  ];
}

const columnDefs = [
  "id INTEGER PRIMARY KEY AUTOINCREMENT",
  "username TEXT NOT NULL",
  "email TEXT NOT NULL UNIQUE",
  "age INTEGER",
  "gender TEXT",
  "is_active BOOLEAN",
  "login_count INTEGER",
  "score REAL",
  "location TEXT",
  "status TEXT",
  "created_at TEXT",
  "last_login TEXT",
  "settings TEXT",
  "preferences TEXT",
  ...Array.from({ length: 16 }, (_, i) => `field${i + 1} TEXT`),
];

const indexStatements = [
  "CREATE INDEX idx_users_username ON users(username);",
  "CREATE INDEX idx_users_email ON users(email);",
  "CREATE INDEX idx_users_age ON users(age);",
  "CREATE INDEX idx_users_location ON users(location);",
  "CREATE INDEX idx_users_gender ON users(gender);",
  "CREATE INDEX idx_users_created_at ON users(created_at);",
  "CREATE INDEX idx_users_is_active ON users(is_active);",
  "CREATE INDEX idx_users_status ON users(status);",
  "CREATE INDEX idx_users_login_count ON users(login_count);",
  "CREATE INDEX idx_users_score ON users(score);",
];

// 生成列名和插入占位符
const colNames = columnDefs.slice(1).map((def) => def.split(" ")[0]);
const sqliteInsertSQL = `INSERT INTO users (${colNames.join(
  ", "
)}) VALUES (${Array(colNames.length).fill("?").join(", ")})`;

// 生成所有用户数据
const users = Array.from({ length: DB_ROWS }, (_, i) => generateMockUser(i));

// 生成所有订单数据
const orders = Array.from({ length: DB_ROWS }, (_, i) => generateMockOrder(i));

/* =============================
   sqlite3 部分（异步回调）
   ============================= */
const SQLITE3_PATH = path.join(__dirname, "data/sqlite3.db");
const sqlite3db = new sqlite3.Database(SQLITE3_PATH, (err) => {
  if (err) {
    console.error("Error opening sqlite3 DB:", err.message);
  }
});
// 配置 WAL 模式
sqlite3db.run("PRAGMA journal_mode = WAL");

// 初始化 sqlite3 数据库结构：删除旧表、创建新表、添加索引
sqlite3db.serialize(() => {
  sqlite3db.run("DROP TABLE IF EXISTS users");
  sqlite3db.run("DROP TABLE IF EXISTS orders");
  sqlite3db.run(`CREATE TABLE users (${columnDefs.join(", ")});`);
  sqlite3db.run(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL,
      user_id INTEGER,
      status TEXT,
      amount REAL,
      created_at TEXT,
      updated_at TEXT,
      payment_info TEXT,
      ${Array.from({ length: 16 }, (_, i) => `field${i + 1} TEXT`).join(
        ",\n      "
      )}
    );
  `);
  indexStatements.forEach((stmt) => sqlite3db.run(stmt));
  sqlite3db.run("CREATE INDEX idx_orders_user_id ON orders(user_id);");
  sqlite3db.run("CREATE INDEX idx_orders_status ON orders(status);");
});

/* =============================
   PostgreSQL 部分（使用连接池）
   ============================= */
const pgPool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "testdb",
  password: "postgres",
  port: 5432,
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

async function initPostgres() {
  // 先删除 orders 表，再删除 users 表
  await pgPool.query("DROP TABLE IF EXISTS orders CASCADE");
  await pgPool.query("DROP TABLE IF EXISTS users CASCADE");

  await pgPool.query(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      age INTEGER,
      gender TEXT,
      is_active BOOLEAN,
      login_count INTEGER,
      score REAL,
      location TEXT,
      status TEXT,
      created_at TIMESTAMP,
      last_login TIMESTAMP,
      settings TEXT,
      preferences TEXT,
      ${Array.from({ length: 16 }, (_, i) => `field${i + 1} TEXT`).join(
        ",\n      "
      )}
    );
  `);

  await pgPool.query(`
    CREATE TABLE orders (
      id SERIAL PRIMARY KEY,
      order_number TEXT NOT NULL,
      user_id INTEGER,
      status TEXT,
      amount REAL,
      created_at TIMESTAMP,
      updated_at TIMESTAMP,
      payment_info TEXT,
      ${Array.from({ length: 16 }, (_, i) => `field${i + 1} TEXT`).join(
        ",\n      "
      )}
    );
  `);

  for (const stmt of indexStatements) {
    await pgPool.query(stmt);
  }
  await pgPool.query("CREATE INDEX idx_orders_user_id ON orders(user_id);");
  await pgPool.query("CREATE INDEX idx_orders_status ON orders(status);");

  console.log(`📅 [PostgreSQL] Inserting ${DB_ROWS} rows...`);
  const sampleRow = users[0];
  const FIELDS_PER_ROW = sampleRow.length;
  const MAX_PARAMETERS = 60000;
  const batchSize = Math.floor(MAX_PARAMETERS / FIELDS_PER_ROW);

  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    const flat = batch.flat();

    const placeholders = batch
      .map((_, rowIdx) => {
        const offset = rowIdx * FIELDS_PER_ROW;
        return `(${Array.from(
          { length: FIELDS_PER_ROW },
          (_, colIdx) => `$${offset + colIdx + 1}`
        ).join(", ")})`;
      })
      .join(", ");

    const sql = `
      INSERT INTO users (
        username, email, age, gender, is_active, login_count, score, location,
        status, created_at, last_login, settings, preferences,
        ${Array.from({ length: 16 }, (_, i) => `field${i + 1}`).join(", ")}
      ) VALUES ${placeholders};
    `;
    await pgPool.query(sql, flat);
  }

  // Insert orders data
  console.log(`📅 [PostgreSQL] Inserting ${DB_ROWS} orders...`);
  const sampleOrder = orders[0];
  const FIELDS_PER_ORDER = sampleOrder.length;
  const batchSizeOrders = Math.floor(MAX_PARAMETERS / FIELDS_PER_ORDER);

  for (let i = 0; i < orders.length; i += batchSizeOrders) {
    const batchOrders = orders.slice(i, i + batchSizeOrders);
    const flatOrders = batchOrders.flat();

    const placeholdersOrders = batchOrders
      .map((_, rowIdx) => {
        const offsetOrders = rowIdx * FIELDS_PER_ORDER;
        return `(${Array.from(
          { length: FIELDS_PER_ORDER },
          (_, colIdx) => `$${offsetOrders + colIdx + 1}`
        ).join(", ")})`;
      })
      .join(", ");

    const sqlOrders = `
      INSERT INTO orders (
        order_number, user_id, status, amount, created_at, updated_at, payment_info,
        ${Array.from({ length: 16 }, (_, i) => `field${i + 1}`).join(", ")}
      ) VALUES ${placeholdersOrders};
    `;
    await pgPool.query(sqlOrders, flatOrders);
  }

  const result = await pgPool.query("SELECT count(*) FROM users");
  console.log(`✅ [PostgreSQL] Users table has ${result.rows[0].count} rows.`);
  const orderResult = await pgPool.query("SELECT count(*) FROM orders");
  console.log(
    `✅ [PostgreSQL] Orders table has ${orderResult.rows[0].count} rows.`
  );
}

/* =============================
   API 路由定义
   ============================= */

// sqlite3 接口
app.get("/sqlite3/read/complicated", (req, res) => {
  const query = `
    SELECT * FROM users
    WHERE age BETWEEN 25 AND 35
      AND gender = 'male'
      AND is_active = 1
      AND created_at >= datetime('now', '-1 year')
    ORDER BY last_login DESC
    LIMIT 10
  `;
  sqlite3db.all(query, (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

app.post("/sqlite3/write", (req, res) => {
  const row = generateMockUser(Date.now());
  sqlite3db.run(sqliteInsertSQL, row, function (err) {
    if (err) res.status(500).json({ error: err.message });
    else res.json({ success: true, lastID: this.lastID });
  });
});

app.post("/sqlite3/rw", (req, res) => {
  const row = generateMockUser(Date.now());
  sqlite3db.run(sqliteInsertSQL, row, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    sqlite3db.get(
      "SELECT * FROM users where username = ?",
      [row[0]],
      (err, afterRow) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(afterRow);
      }
    );
  });
});

app.post("/sqlite3/count", (req, res) => {
  sqlite3db.get("SELECT count(*) as c FROM users", (err, beforeRow) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ before: beforeRow.c });
  });
});

app.get("/sqlite3/read/indexed", (req, res) => {
  const query = `
    SELECT * FROM users
    WHERE age = 30
    ORDER BY login_count DESC
    LIMIT 10
  `;
  sqlite3db.all(query, (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

app.get("/sqlite3/read/noindex", (req, res) => {
  const query = `
    SELECT * FROM users
    WHERE preferences LIKE '%dark%'
    ORDER BY username DESC
    LIMIT 10
  `;
  sqlite3db.all(query, (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

app.get("/sqlite3/read/pages", (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const pageSize = parseInt(req.query.pageSize, 10) || 10;
  const offset = (page - 1) * pageSize;

  const query = `SELECT * FROM users ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`;
  sqlite3db.all(query, (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

// PostgreSQL 接口
app.get("/postgres/read/complicated", async (req, res) => {
  try {
    const result = await pgPool.query(`
      SELECT * FROM users
      WHERE age BETWEEN 25 AND 35
        AND gender = 'male'
        AND is_active = true
        AND created_at >= NOW() - INTERVAL '1 year'
      ORDER BY last_login DESC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/postgres/write", async (req, res) => {
  try {
    const row = generateMockUser(Date.now());
    const values = row.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO users (
      username, email, age, gender, is_active, login_count, score, location,
      status, created_at, last_login, settings, preferences,
      ${Array.from({ length: 16 }, (_, i) => `field${i + 1}`).join(", ")}
    ) VALUES (${values})`;
    await pgPool.query(sql, row);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/postgres/rw", async (req, res) => {
  try {
    const row = generateMockUser(Date.now());
    const values = row.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO users (
      username, email, age, gender, is_active, login_count, score, location,
      status, created_at, last_login, settings, preferences,
      ${Array.from({ length: 16 }, (_, i) => `field${i + 1}`).join(", ")}
    ) VALUES (${values})`;
    await pgPool.query(sql, row);
    const after = await pgPool.query(
      "SELECT * FROM users where username = $1",
      [row[0]]
    );
    res.json(after.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/postgres/count", async (req, res) => {
  const before = await pgPool.query("SELECT count(*) FROM users");
  res.json({ before: before.rows[0].count });
});

app.get("/postgres/read/indexed", async (req, res) => {
  try {
    const result = await pgPool.query(`
      SELECT * FROM users
      WHERE age = 30
      ORDER BY login_count DESC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/postgres/read/noindex", async (req, res) => {
  try {
    const result = await pgPool.query(`
      SELECT * FROM users
      WHERE preferences LIKE '%dark%'
      ORDER BY username DESC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/postgres/read/pages", async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const pageSize = parseInt(req.query.pageSize, 10) || 10;
    const offset = (page - 1) * pageSize;

    const sql = `SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
    const result = await pgPool.query(sql, [pageSize, offset]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 添加新的测试接口
app.get("/sqlite3/read/exists/full", (req, res) => {
  const query = `
    SELECT 
      u.*,
      (SELECT o.order_number FROM orders o 
       WHERE o.user_id = u.id 
       AND o.status = 'completed' 
       AND o.amount > 50 
       ORDER BY o.amount DESC 
       LIMIT 1) as order_number,
      (SELECT o.amount FROM orders o 
       WHERE o.user_id = u.id 
       AND o.status = 'completed' 
       AND o.amount > 50 
       ORDER BY o.amount DESC 
       LIMIT 1) as order_amount
    FROM users u
    WHERE EXISTS (
      SELECT 1 FROM orders o
      WHERE o.user_id = u.id
      AND o.status = 'completed'
      AND o.amount > 50
    )
    ORDER BY u.created_at DESC
    LIMIT 10
  `;
  sqlite3db.all(query, (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

app.get("/sqlite3/read/join/full", (req, res) => {
  const query = `
    SELECT u.*, o.order_number, o.amount, o.status as order_status
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE o.status = 'completed'
    AND o.amount > 50
    ORDER BY u.created_at DESC
    LIMIT 10
  `;
  sqlite3db.all(query, (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

app.get("/postgres/read/exists/full", async (req, res) => {
  try {
    const result = await pgPool.query(`
      SELECT 
        u.*,
        (SELECT o.order_number FROM orders o 
         WHERE o.user_id = u.id 
         AND o.status = 'completed' 
         AND o.amount > 50 
         ORDER BY o.amount DESC 
         LIMIT 1) as order_number,
        (SELECT o.amount FROM orders o 
         WHERE o.user_id = u.id 
         AND o.status = 'completed' 
         AND o.amount > 50 
         ORDER BY o.amount DESC 
         LIMIT 1) as order_amount
      FROM users u
      WHERE EXISTS (
        SELECT 1 FROM orders o
        WHERE o.user_id = u.id
        AND o.status = 'completed'
        AND o.amount > 50
      )
      ORDER BY u.created_at DESC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/postgres/read/join/full", async (req, res) => {
  try {
    const result = await pgPool.query(`
      SELECT u.*, o.order_number, o.amount, o.status as order_status
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
    WHERE o.status = 'completed'
    AND o.amount > 50
    ORDER BY u.created_at DESC
    LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =============================
   数据库初始化函数
   ============================= */
async function initdb() {
  console.log("🚀 Starting database initialization...");

  // SQLite3 初始化
  const sqliteInitPromise = new Promise((resolve, reject) => {
    console.log(`📅 [SQLite3] Inserting ${DB_ROWS} rows...`);
    sqlite3db.serialize(() => {
      sqlite3db.run("BEGIN TRANSACTION");
      const userStmt = sqlite3db.prepare(sqliteInsertSQL);
      const orderStmt = sqlite3db.prepare(`
        INSERT INTO orders (
          order_number, user_id, status, amount, created_at, updated_at, payment_info,
          ${Array.from({ length: 16 }, (_, i) => `field${i + 1}`).join(", ")}
        ) VALUES (${Array(23).fill("?").join(", ")})
      `);

      for (let i = 0; i < users.length; i++) {
        userStmt.run(users[i]);
        orderStmt.run(orders[i]);
      }

      userStmt.finalize();
      orderStmt.finalize();

      sqlite3db.run("COMMIT", (err) => {
        if (err) {
          console.error("Error committing sqlite3 transaction:", err.message);
          reject(err);
          return;
        }
        sqlite3db.get("SELECT count(*) as c FROM users", (err, row) => {
          if (err) {
            console.error("Error selecting count from sqlite3:", err.message);
            reject(err);
            return;
          }
          console.log(`✅ [SQLite3] Users table has ${row.c} rows.`);
          sqlite3db.get("SELECT count(*) as c FROM orders", (err, row) => {
            if (err) {
              console.error("Error selecting count from sqlite3:", err.message);
              reject(err);
              return;
            }
            console.log(`✅ [SQLite3] Orders table has ${row.c} rows.`);
            sqlite3db.exec("ANALYZE;", (err) => {
              if (err) {
                console.error("Error analyzing sqlite3:", err.message);
                reject(err);
                return;
              }
              console.log("✅ [SQLite3] Analyzed.");
              resolve();
            });
          });
        });
      });
    });
  });

  // PostgreSQL 初始化
  const pgInitPromise = initPostgres();

  try {
    // 等待两个数据库都初始化完成
    await Promise.all([sqliteInitPromise, pgInitPromise]);
    console.log("✅ All databases initialized successfully!");
    return true;
  } catch (err) {
    console.error("❌ Database initialization failed:", err);
    return false;
  }
}

/* =============================
   启动服务
   ============================= */
const port = 3333;
initdb().then((success) => {
  if (success) {
    app.listen(port, () => {
      console.log(`✅ Server running at http://localhost:${port}`);
    });
  } else {
    console.error(
      "❌ Server startup aborted due to database initialization failure"
    );
    process.exit(1);
  }
});
