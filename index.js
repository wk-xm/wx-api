const mysql = require('mysql2/promise');

let pool;

// 初始化数据库连接（复用成功的连接逻辑）
async function initDB() {
  if (pool) return pool; // 避免重复创建连接池
  const mysqlUrl = process.env.MYSQL_URL;
  const url = new URL(mysqlUrl);
  const dbConfig = {
    host: url.hostname,
    port: url.port || 4000,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl: { rejectUnauthorized: false },
    connectTimeout: 15000,
    connectionLimit: 5
  };
  pool = mysql.createPool(dbConfig);
  // 测试连接（保留日志）
  const [rows] = await pool.query('SELECT 1');
  console.log("✅ 数据库连接池初始化成功，测试结果：", rows);
  return pool;
}

// 数据库连接测试（保留原有日志）
async function testDBConnection() {
  console.log("===== 开始测试数据库连接 =====");
  console.log("🔍 步骤1：检查 MYSQL_URL 环境变量");
  if (!process.env.MYSQL_URL) {
    console.error("❌ 失败：MYSQL_URL 环境变量未配置！");
    return false;
  }
  console.log("✅ 成功：MYSQL_URL 环境变量已配置");
  console.log("🔍 MYSQL_URL 脱敏值：", process.env.MYSQL_URL.replace(/:.+@/, ':****@'));

  try {
    const url = new URL(process.env.MYSQL_URL);
    console.log("\n✅ 步骤2：连接串解析完成");
    console.log("🔍 解析后的配置：", {
      host: url.hostname,
      port: url.port || 4000,
      user: url.username,
      database: url.pathname.slice(1)
    });

    console.log("\n🔍 步骤3：尝试连接数据库");
    await initDB();
    console.log("✅ 成功：数据库连接正常！");
    console.log("===== 连接测试完成 =====");
    return true;
  } catch (err) {
    console.error("\n❌ 失败：数据库连接错误 →", err.message);
    console.error("❌ 错误详情：", err.stack.slice(0, 200));
    return false;
  }
}

// ====================== 用户表（user）核心接口 ======================
/**
 * 1. 存储/更新用户信息
 * @param {Object} userInfo - 用户信息对象
 * @returns {Object} 操作结果
 */
async function saveUser(userInfo) {
  const { wxid, username, sex, birthday, consumptionLevel, avatarUrl, role } = userInfo;
  try {
    const pool = await initDB();
    // 自动创建user表（首次运行）
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`user\` (
        \`username\` varchar(100) DEFAULT NULL COMMENT '用户名',
        \`wxid\` varchar(50) NOT NULL COMMENT '用户唯一标识（微信OpenID）',
        \`sex\` varchar(100) DEFAULT NULL COMMENT '性别',
        \`birthday\` varchar(100) DEFAULT NULL COMMENT '生日',
        \`consumptionLevel\` varchar(100) DEFAULT NULL COMMENT '消费等级',
        \`avatarUrl\` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL COMMENT '头像',
        \`role\` varchar(100) DEFAULT NULL COMMENT '身份',
        PRIMARY KEY (\`wxid\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
    // 插入/更新用户信息（wxid为主键，重复则更新）
    const [result] = await pool.query(`
      INSERT INTO \`user\` (wxid, username, sex, birthday, consumptionLevel, avatarUrl, role)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        username=?, sex=?, birthday=?, consumptionLevel=?, avatarUrl=?, role=?
    `, [
      wxid, username, sex, birthday, consumptionLevel, avatarUrl, role,
      username, sex, birthday, consumptionLevel, avatarUrl, role
    ]);
    console.log("✅ 用户信息存储成功：", result);
    return { code: 0, msg: "用户信息存储成功", data: result };
  } catch (err) {
    console.error("❌ 存储用户信息失败：", err.message);
    return { code: -1, msg: "存储用户信息失败", error: err.message };
  }
}

/**
 * 2. 根据wxid查询用户信息
 * @param {string} wxid - 用户唯一标识
 * @returns {Object} 用户信息
 */
async function getUserByWxid(wxid) {
  try {
    const pool = await initDB();
    const [rows] = await pool.query(`
      SELECT * FROM \`user\` WHERE wxid = ?
    `, [wxid]);
    console.log("✅ 查询用户信息成功：", rows);
    return { code: 0, msg: "查询用户信息成功", data: rows[0] || null };
  } catch (err) {
    console.error("❌ 查询用户信息失败：", err.message);
    return { code: -1, msg: "查询用户信息失败", error: err.message };
  }
}

// ====================== 订单表（orders）核心接口 ======================
/**
 * 1. 创建订单
 * @param {Object} orderInfo - 订单信息对象
 * @returns {Object} 操作结果
 */
async function createOrder(orderInfo) {
  const { order_id, user_id, username, create_time, dishes, total_price, notes, status, reject_reason } = orderInfo;
  try {
    const pool = await initDB();
    // 自动创建orders表（首次运行）
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`orders\` (
        \`order_id\` varchar(50) NOT NULL COMMENT '订单唯一ID（自增主键）',
        \`user_id\` varchar(50) NOT NULL COMMENT '下单用户ID（关联user.wxid）',
        \`username\` varchar(50) NOT NULL COMMENT '下单用户名',
        \`create_time\` datetime NOT NULL COMMENT '订单创建时间（YYYY-MM-DD HH:MM:SS）',
        \`dishes\` text NOT NULL COMMENT '菜品信息（JSON字符串：ID、名称、价格、数量等）',
        \`total_price\` decimal(10,2) NOT NULL COMMENT '订单总金额（精确到分）',
        \`notes\` varchar(200) NOT NULL DEFAULT '无特殊要求' COMMENT '用户订单备注',
        \`status\` varchar(20) DEFAULT '待接单' COMMENT '订单状态（待接单/已接单/已拒单/已完成）',
        \`reject_reason\` varchar(200) DEFAULT '' COMMENT '拒单理由（仅已拒单状态有效）',
        PRIMARY KEY (\`order_id\`),
        KEY \`user_id\` (\`user_id\`),
        CONSTRAINT \`orders_ibfk_1\` FOREIGN KEY (\`user_id\`) REFERENCES \`user\` (\`wxid\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='订单主表：存储所有用户订单，支持权限隔离查询';
    `);
    // 插入订单数据
    const [result] = await pool.query(`
      INSERT INTO \`orders\` (order_id, user_id, username, create_time, dishes, total_price, notes, status, reject_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      order_id, user_id, username, create_time, dishes, total_price, notes, status || '待接单', reject_reason || ''
    ]);
    console.log("✅ 订单创建成功：", result);
    return { code: 0, msg: "订单创建成功", data: result };
  } catch (err) {
    console.error("❌ 创建订单失败：", err.message);
    return { code: -1, msg: "创建订单失败", error: err.message };
  }
}

/**
 * 2. 根据订单ID查询订单详情
 * @param {string} order_id - 订单唯一ID
 * @returns {Object} 订单信息
 */
async function getOrderById(order_id) {
  try {
    const pool = await initDB();
    const [rows] = await pool.query(`
      SELECT * FROM \`orders\` WHERE order_id = ?
    `, [order_id]);
    console.log("✅ 查询订单详情成功：", rows);
    return { code: 0, msg: "查询订单详情成功", data: rows[0] || null };
  } catch (err) {
    console.error("❌ 查询订单详情失败：", err.message);
    return { code: -1, msg: "查询订单详情失败", error: err.message };
  }
}

/**
 * 3. 根据用户wxid查询所有订单
 * @param {string} user_id - 用户wxid
 * @returns {Array} 订单列表
 */
async function getOrdersByUserId(user_id) {
  try {
    const pool = await initDB();
    const [rows] = await pool.query(`
      SELECT * FROM \`orders\` WHERE user_id = ? ORDER BY create_time DESC
    `, [user_id]);
    console.log("✅ 查询用户订单列表成功：", rows);
    return { code: 0, msg: "查询用户订单列表成功", data: rows };
  } catch (err) {
    console.error("❌ 查询用户订单列表失败：", err.message);
    return { code: -1, msg: "查询用户订单列表失败", error: err.message };
  }
}

/**
 * 4. 更新订单状态
 * @param {string} order_id - 订单ID
 * @param {string} status - 订单状态（待接单/已接单/已拒单/已完成）
 * @param {string} reject_reason - 拒单理由（仅状态为已拒单时必填）
 * @returns {Object} 操作结果
 */
async function updateOrderStatus(order_id, status, reject_reason = '') {
  try {
    const pool = await initDB();
    let updateSql = `UPDATE \`orders\` SET status = ?`;
    const params = [status];
    // 拒单时补充拒单理由
    if (status === '已拒单') {
      updateSql += `, reject_reason = ?`;
      params.push(reject_reason || '无');
    }
    updateSql += ` WHERE order_id = ?`;
    params.push(order_id);

    const [result] = await pool.query(updateSql, params);
    console.log("✅ 订单状态更新成功：", result);
    return { 
      code: 0, 
      msg: `订单状态已更新为${status}`, 
      data: result,
      reject_reason: status === '已拒单' ? reject_reason : ''
    };
  } catch (err) {
    console.error("❌ 更新订单状态失败：", err.message);
    return { code: -1, msg: "更新订单状态失败", error: err.message };
  }
}

// ====================== Vercel HTTP 处理函数（接口路由） ======================
module.exports = async (req, res) => {
  // 解决跨域（小程序必配）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS 请求预处理（小程序预检请求）
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 路径路由：区分不同接口
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  
  // 1. 测试数据库连接
  if (pathname === '/test-db') {
    const isConnected = await testDBConnection();
    return res.status(200).json({
      code: isConnected ? 0 : -1,
      msg: isConnected ? "数据库连接成功" : "数据库连接失败"
    });
  }

  // ====================== 用户表接口路由 ======================
  // 2. 存储/更新用户信息（POST）
  if (pathname === '/save-user' && req.method === 'POST') {
    const { wxid, username, sex, birthday, consumptionLevel, avatarUrl, role } = req.body;
    if (!wxid) {
      return res.status(200).json({ code: -1, msg: "wxid（用户唯一标识）不能为空" });
    }
    const result = await saveUser({ wxid, username, sex, birthday, consumptionLevel, avatarUrl, role });
    return res.status(200).json(result);
  }

  // 3. 查询用户信息（GET）
  if (pathname === '/get-user' && req.method === 'GET') {
    const wxid = req.query.wxid;
    if (!wxid) {
      return res.status(200).json({ code: -1, msg: "wxid（用户唯一标识）不能为空" });
    }
    const result = await getUserByWxid(wxid);
    return res.status(200).json(result);
  }

  // ====================== 订单表接口路由 ======================
  // 4. 创建订单（POST）
  if (pathname === '/create-order' && req.method === 'POST') {
    const { order_id, user_id, username, create_time, dishes, total_price, notes, status, reject_reason } = req.body;
    // 必传参数校验
    if (!order_id || !user_id || !username || !create_time || !dishes || !total_price) {
      return res.status(200).json({ code: -1, msg: "订单ID、用户ID、用户名、创建时间、菜品信息、总金额为必填项" });
    }
    const result = await createOrder({
      order_id, user_id, username, create_time, dishes, total_price, notes, status, reject_reason
    });
    return res.status(200).json(result);
  }

  // 5. 查询订单详情（GET）
  if (pathname === '/get-order' && req.method === 'GET') {
    const order_id = req.query.order_id;
    if (!order_id) {
      return res.status(200).json({ code: -1, msg: "订单ID不能为空" });
    }
    const result = await getOrderById(order_id);
    return res.status(200).json(result);
  }

  // 6. 查询用户所有订单（GET）
  if (pathname === '/get-orders-by-user' && req.method === 'GET') {
    const user_id = req.query.user_id;
    if (!user_id) {
      return res.status(200).json({ code: -1, msg: "用户ID（wxid）不能为空" });
    }
    const result = await getOrdersByUserId(user_id);
    return res.status(200).json(result);
  }

  // 7. 更新订单状态（POST/PUT）
  if (pathname === '/update-order-status' && (req.method === 'POST' || req.method === 'PUT')) {
    const { order_id, status, reject_reason } = req.body;
    if (!order_id || !status) {
      return res.status(200).json({ code: -1, msg: "订单ID和状态为必填项" });
    }
    // 拒单时校验理由
    if (status === '已拒单' && !reject_reason) {
      return res.status(200).json({ code: -1, msg: "拒单状态需填写拒单理由" });
    }
    const result = await updateOrderStatus(order_id, status, reject_reason);
    return res.status(200).json(result);
  }

  // 8. 根路径提示
  res.status(200).json({
    code: 0,
    msg: "小程序用户/订单接口服务运行正常",
    apis: [
      // 数据库测试
      "/test-db (GET) - 测试数据库连接",
      // 用户接口
      "/save-user (POST) - 存储/更新用户信息（传wxid/username/sex等）",
      "/get-user (GET) - 查询用户信息（传wxid参数）",
      // 订单接口
      "/create-order (POST) - 创建订单（传order_id/user_id/dishes等）",
      "/get-order (GET) - 查询订单详情（传order_id参数）",
      "/get-orders-by-user (GET) - 查询用户所有订单（传user_id参数）",
      "/update-order-status (POST/PUT) - 更新订单状态（传order_id/status/reject_reason）"
    ]
  });
};

// 本地运行入口
if (require.main === module) {
  testDBConnection();
}
