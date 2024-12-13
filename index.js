const axios = require('axios');
const cheerio = require('cheerio');

// lấy các link từ trang chủ
const getArticles = async (url) => {
    try{
        console.log(`Fetching links from: ${url}`);
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const links = []; // một mảng chứa các link
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.startsWith('/')) {
                links.push(`https://baomoi.com${href}`);
            }
        });

        // loại bỏ các link trùng lặp
        const uniqueLinks = [...new Set(links)]; // tạo mảng mới chứa các phần tử duy nhất
        console.log(`Số link kh trùng lặp tìm đc ${uniqueLinks.length}`);
        return uniqueLinks;
    }catch (error) {
        console.error('Error fetching links:', error.message);
        return [];
    }
};

//lấy thông tin từ một bài báo
const scrapeArticle = async (url) => {
    try{
        console.log(`Fetching article from: ${url}`);
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        // lấy tiêu đề
        const title = $('h1').text().trim();

        // lấy content
        const content = [];
        $('p').each((i, el) => { // duyệt tất cả thẻ p
            const text = $(el).text().trim(); // loại khoảng trắng
            if (text) content.push(text); // lưu vào mảng content
        });

        // lấy tag
        // const tags = [];
        // $('a.tag').each((i, el) => {
        //     tags.push($(el).text().trim());
        // })
        const tags = [];
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            // chỉ chọn các thẻ có href bắt đầu bằng "/tag/"
            if (href && href.startsWith('/tag/')) {
                const tagName = $(el).text().trim(); // Lấy nội dung tag
                tags.push(tagName);
            }
        });
 

        /// lấy ảnh (nếu có)
        
        // $('img').each((i, el) => {
        //     const src = $(el).attr('src');
        //     if (src) {
        //         images.push(src.trim()); // Lưu đường dẫn của ảnh
        //     }
        // });
        const images = [];
        $('img').each((i, el) => {
            const src = $(el).attr('src');
            if (src && src.startsWith('http')) {
                images.push(src.trim());
            }
        });


        // kiểm tra tiêu đề và nội dung
        if (!title || content.length === 0) {
            console.log(`Bỏ qua bài báo thiếu nội dung hoặc tiêu đề: ${url}`);
            return null; // Bỏ qua bài báo
        }

        return { title, content: content.join('\n'), tags, images}; // kết hợp thành 1 chuỗi, và cách nhau bởi /n
    }catch(error) {
        console.error(`Lỗi ${url}:`, error.message);
        return null;
    }
}

// kết nối và đưa dữ liệu lên mysql
const mysql = require('mysql2/promise');

// Cấu hình kết nối MySQL
const config = {
    host: 'localhost',         // Địa chỉ máy chủ (localhost khi dùng XAMPP)
    user: 'root',              // Tài khoản MySQL (mặc định là root)
    password: '',              // Mật khẩu MySQL (mặc định trống trong XAMPP)
    database: 'dbcrawl'        // Tên cơ sở dữ liệu
};

// Hàm kết nối đến MySQL
const connectToDatabase = async () => {
    try {
        const pool = await mysql.createPool(config);
        console.log('Connected to MySQL');
        return pool;
    } catch (error) {
        console.error('Database connection error:', error.message);
        throw error;
    }
};

//****************************************************** */
const saveArticleToDatabase = async (pool, article, link) => {
    try {
        // Chuyển toàn bộ bài báo thành JSON
        const articleData = JSON.stringify({
            title: article.title,
            content: article.content,
            tags: article.tags,
            images: article.images
        });

        const sql = `
            INSERT INTO article (article_data, link)
            VALUES (?,?)
        `;
        const [result] = await pool.execute(sql, [articleData, link]);
        console.log(`Article "${article.title}" saved to database. ID: ${result.insertId}`);
    } catch (error) {
        // Xử lý lỗi trùng lặp
        if (error.code === 'ER_DUP_ENTRY') {
            console.log(`Link "${link}" đã tồn tại trong cơ sở dữ liệu. Bỏ qua.`);
        } else {
            console.error('Error saving article:', error.message);
        }
    }
};


// kiểm tra nếu đã tồn tại thì không thêm
const isArticleExists = async (pool, link) => {
    try {
        const sql = `SELECT COUNT(*) as count FROM article WHERE link = ?`;
        const [rows] = await pool.execute(sql, [link]);
        return rows[0].count > 0; // Trả về true nếu bài báo đã tồn tại
    } catch (error) {
        console.error('Error checking article existence:', error.message);
        return false; // Trả về false nếu có lỗi
    }
};

// hàm main
const main = async () => {
    // Kết nối đến cơ sở dữ liệu
    const pool = await connectToDatabase();

    if (!pool) {
        console.error('Database pool is not available.');
        return;
    }

    // lấy các link bài báo từ trang chủ
    const links = await getArticles('https://baomoi.com/');

    // tạo mảng lưu các bài báo đã cào
    const articles = [];

    // duyệt qua từng bài báo và lưu vào cơ sở dữ liệu
    for (let i = 0; i < Math.min(100, links.length); i++) {
        const link = links[i];

        // kiểm tra link đã tồn tại hay chưa
        const exists = await isArticleExists(pool, link);
        if (!exists) { // nếu Link chưa tồn tại
            const article = await scrapeArticle(link);
            if (article) {
                await saveArticleToDatabase(pool, article, link);
                articles.push(article);
            }
        } else {
            console.log(`Link báo đã tồn tại "${link}"`);
        }
    }

    console.log(articles);
    await pool.end(); // đóng kết nối cơ sở dữ liệu
}

main();

