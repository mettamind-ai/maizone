# Cách Hoạt Động - Kiến Trúc Tiện Ích Mai

Những tên file chuẩn khi xây dựng browser extension:

- `background.js`: Script chạy nền
- `content.js`: Script tương tác với trang web
- `popup.html`/`popup.js`: Giao diện khi click vào biểu tượng extension
- `options.html`/`options.js`: Trang cài đặt cho extension

## Content Script và Background Script

`content.js` theo dõi thao tác người dùng và hiển thị giao diện, trong khi `background.js` xử lý logic và điều phối các chức năng.

### `content.js`
- **Phạm vi**: Chạy trong trang web người dùng đang truy cập, truy cập DOM
- **Nhiệm vụ**: Theo dõi sự kiện (nhập liệu, focus), hiển thị UI, gửi dữ liệu đến `background.js`
- **Vòng đời**: Tải khi người dùng truy cập trang web phù hợp
- **Giao tiếp**: Gửi/nhận message từ background.js, truy cập chrome.storage
- **API**: Truy cập hạn chế API Chrome, chủ yếu tương tác với trang web

### `background.js`
- **Phạm vi**: Chạy ở nền, độc lập với trang web
- **Nhiệm vụ**: Quản lý trạng thái, xử lý logic (dự đoán văn bản, kiểm tra trang web), lưu trữ cài đặt
- **Vòng đời**: Hoạt động liên tục khi extension được kích hoạt
- **Giao tiếp**: Tương tác với tất cả content scripts, quản lý API trình duyệt
- **API**: Truy cập đầy đủ API Chrome (tabs, storage, alerts, network)

## Luồng Dữ Liệu

```
+-------------+         +----------------+         +--------------+
|  Thao tác   | ------> |  content.js    | ------> | background.js|
|  Người dùng |         |                |         |              |
+-------------+         +----------------+         +--------------+
      ^                        |                         |
      |                        v                         v
+-------------+         +----------------+         +--------------+
|  Trang Web  | <------ |  Giao diện UI  | <------ |  Lưu trữ     |
+-------------+         +----------------+         +--------------+
```

1. Người dùng tương tác với trang web
2. `content.js` ghi nhận sự kiện (gõ phím, focus)
3. Dữ liệu được gửi đến `background.js` để xử lý
4. background.js xử lý logic và cập nhật lưu trữ
5. Kết quả trả về `content.js`
6. `content.js` cập nhật giao diện người dùng

## Hệ Thống Truyền Tin

Extension sử dụng hệ thống truyền tin để giao tiếp giữa các thành phần:

```javascript
// Từ content.js đến background.js
sendMessageSafely({
  action: 'requestTextPrediction',
  data: { /* dữ liệu */ }
});

// Từ background.js đến content.js
chrome.tabs.sendMessage(tabId, {
  action: 'textPredictionResult',
  data: { /* kết quả */ }
});
```

## Popup và Trang Cài Đặt

### Popup (`popup.html`, `popup.js`)
- **Phạm vi**: Hiển thị khi click vào biểu tượng extension
- **Nhiệm vụ**: Hiển thị trạng thái, cung cấp điều khiển nhanh, thống kê ngắn gọn
- **Tương tác**: Đọc trạng thái từ storage, gửi lệnh đến `background.js`

### Trang Cài Đặt (`options.html`, `options.js`)
- **Phạm vi**: Trang cấu hình đầy đủ
- **Nhiệm vụ**: Quản lý tất cả cài đặt, cấu hình chi tiết các tính năng
- **Lưu trữ**: Lưu cài đặt vào chrome.storage.sync hoặc chrome.storage.local

## Tổng Quan Kiến Trúc

```
+----------------+
|  Giao diện     |
|  Extension     |
+-------+--------+
        |                        
        |        +----------------+      +------------------+
        |        |                |      |                  |
+-------v----------------+  +-----v-------------+  +--------v---------------+
|                        |  |                   |  |                        |
|  popup.js/popup.html   |  |  options.js/html  |  |    background.js       |
|  (Điều khiển nhanh)    |  |  (Cài đặt đầy đủ) |  |    (Logic xử lý)       |
+-----------+------------+  +--------+----------+  +------------+-----------+
            |                        |                          |
            |                        |                          |
            +------------------------+--------------------------+
                                     |
                                     | Truy cập lưu trữ
                          +----------v------------+
                          |                       |
                          |  chrome.storage       |
                          |  (Cài đặt người dùng) |
                          |                       |
                          +-----------------------+
                                     |
                          +----------v------------+
                          |                       |
                          |     content.js        |
                          |   (Tương tác trang)   |
                          |                       |
                          +-----------------------+
```