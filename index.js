// 1. 引入核心依赖（仅保留 mysql2）
const mysql = require('mysql2/promise');

// 2. 全局连接池变量
let pool;

// 3. 极简数据库连接函数（每步输出日志）
async function testDBConnection() {
  console.log("===== 开始测试数据库连接 =====");

  // 步骤1：检查环境变量是否存在
  console.log("🔍 步骤1：检查 MYSQL_URL 环境变量");
  if (!process.env.MYSQL_URL) {
    console.error("❌ 失败：MYSQL_URL 环境变量未配置！");
    process.exit(1); // 终止程序
  }
  console.log("✅ 成功：MYSQL_URL 环境变量已配置");
  console.log("🔍 MYSQL_URL 脱敏值：", process.env.MYSQL_URL.replace(/:.+@/, ':****@'));

  // 步骤2：解析连接串
  console.log("\n🔍 步骤2：解析数据库连接串");
  let url;
  try {
    url = new URL(process.env.MYSQL_URL);
    const dbConfig = {
      host: url.hostname,
      port: url.port || 4000,
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1),
      ssl: { rejectUnauthorized: false } // 核心 SSL 配置
    };
    console.log("✅ 成功：连接串解析完成");
    console.log("🔍 解析后的配置：", {
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      database: dbConfig.database,
      ssl: "已开启（忽略证书校验）"
    });

    // 步骤3：创建连接池并测试连接
    console.log("\n🔍 步骤3：创建连接池并测试连接");
    pool = mysql.createPool({
      ...dbConfig,
      connectTimeout: 15000, // 15秒超时
      connectionLimit: 1     // 仅1个连接（极简）
    });

    // 执行最简单的查询（SELECT 1）验证连接
    const [rows] = await pool.query('SELECT 1 AS test_result');
    console.log("✅ 成功：数据库连接正常！");
    console.log("🔍 测试查询结果：", rows);

    // 步骤4：关闭连接池（测试完成）
    console.log("\n🔍 步骤4：关闭数据库连接池");
    await pool.end();
    console.log("✅ 成功：连接池已关闭");
    console.log("===== 数据库连接测试全部完成（基础功能正常） =====");

  } catch (parseErr) {
    console.error("❌ 失败：连接串解析错误 →", parseErr.message);
    process.exit(1);
  } catch (connectErr) {
    console.error("❌ 失败：数据库连接错误 →", connectErr.message);
    console.error("❌ 错误详情：", connectErr.stack.slice(0, 200)); // 只输出前200字符，避免过长
    process.exit(1);
  }
}

// 4. 执行测试函数
testDBConnection();
