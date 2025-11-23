// 1. 核心依赖（仅保留mysql2，极简）
const mysql = require('mysql2/promise');

// 2. 全局连接池
let pool;

// 3. 数据库连接测试（保留所有日志输出）
async function testDBConnection() {
  console.log("===== 开始测试数据库连接 =====");

  // 步骤1：检查环境变量
  console.log("🔍 步骤1：检查 MYSQL_URL 环境变量");
  if (!process.env.MYSQL_URL) {
    console.error("❌ 失败：MYSQL_URL 环境变量未配置！");
    process.exitCode = 1; // 标记错误但不强制退出（适配Vercel）
    return;
  }
  console.log("✅ 成功：MYSQL_URL 环境变量已配置");
  console.log("🔍 MYSQL_URL 脱敏值：", process.env.MYSQL_URL.replace(/:.+@/, ':****@'));

  // 步骤2：解析连接串
  try {
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

    // 步骤3：连接数据库
    console.log("\n🔍 步骤3：尝试连接数据库");
    pool = mysql.createPool(dbConfig);
    const [rows] = await pool.query('SELECT 1 AS test_result');
    
    console.log("✅ 成功：数据库连接正常！");
    console.log("🔍 测试结果：", rows);

    // 步骤4：关闭连接池
    await pool.end();
    console.log("\n✅ 步骤4：连接池已关闭");
    console.log("===== 连接测试完成 =====");

  } catch (err) {
    console.error("\n❌ 失败：数据库连接错误 →", err.message);
    console.error("❌ 错误详情：", err.stack.slice(0, 200));
    process.exitCode = 1;
    return;
  }
}

// 4. Vercel 核心要求：导出 HTTP 处理函数（最简方式）
// 兼容 Vercel Serverless 规范，同时自动执行数据库测试
module.exports = async (req, res) => {
  // 执行数据库连接测试（触发所有日志输出）
  await testDBConnection();
  // 返回简单响应（避免Vercel报404）
  res.status(200).json({
    code: 0,
    msg: "数据库连接测试完成，查看Vercel日志面板获取详情"
  });
};

// 本地运行时自动执行（可选）
if (require.main === module) {
  testDBConnection();
}
