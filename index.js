// 1. 引入核心依赖
const mysql = require('mysql2/promise');

// 2. 全局连接池变量
let pool;

// 3. 数据库连接测试函数（try/catch 结构完整）
async function testDBConnection() {
  console.log("===== 开始测试数据库连接 =====");

  // 步骤1：检查环境变量
  console.log("🔍 步骤1：检查 MYSQL_URL 环境变量");
  if (!process.env.MYSQL_URL) {
    console.error("❌ 失败：MYSQL_URL 环境变量未配置！");
    process.exit(1);
  }
  console.log("✅ 成功：MYSQL_URL 环境变量已配置");
  console.log("🔍 MYSQL_URL 脱敏值：", process.env.MYSQL_URL.replace(/:.+@/, ':****@'));

  // 步骤2：解析+连接数据库（try/catch 完整包裹）
  try {
    // 解析连接串
    const url = new URL(process.env.MYSQL_URL);
    const dbConfig = {
      host: url.hostname,
      port: url.port || 4000,
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1),
      ssl: { rejectUnauthorized: false },
      connectTimeout: 15000,
      connectionLimit: 1
    };
    console.log("\n✅ 步骤2：连接串解析完成");
    console.log("🔍 解析后的配置：", {
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      database: dbConfig.database
    });

    // 创建连接池+测试
    console.log("\n🔍 步骤3：尝试连接数据库");
    pool = mysql.createPool(dbConfig);
    const [rows] = await pool.query('SELECT 1 AS test_result');
    
    console.log("✅ 成功：数据库连接正常！");
    console.log("🔍 测试结果：", rows);

    // 关闭连接池
    await pool.end();
    console.log("\n✅ 步骤4：连接池已关闭");
    console.log("===== 连接测试完成 =====");

  } catch (err) { // catch 紧跟 try 闭合大括号，无语法错位
    console.error("\n❌ 失败：数据库连接错误 →", err.message);
    console.error("❌ 错误详情：", err.stack.slice(0, 200));
    process.exit(1);
  }
}

// 4. 执行测试函数
testDBConnection();
