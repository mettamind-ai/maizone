## Tính năng nổi bật

- **Chặn sao nhãng (f01)**: cảnh báo/chặn truy cập các trang web dễ gây mất tập trung.
- **Deep Work 40 phút (f04 + f03)**: nhập 1 task → vào flow → đếm ngược + nhắc nghỉ; badge hiển thị `mm:ss`.
- **ClipMD (f06)**: **Alt + Q** hoặc **click icon MaiZone** → chọn element trên trang → copy Markdown vào clipboard.
- **ChatGPT Zen Mode (f07)**: trên `chatgpt.com`, **Alt + Z** ẩn/hiện UI; **Alt + S** dán prompt mẫu để AI trả lời **ngắn gọn, từng bước, và hỏi xác nhận**.
- **Mindfulness Reminders (f08)**: toast nhắc thở/giãn cơ mỗi 15' (không nhắc khi Deep Work).


## Hướng dẫn cài đặt và giao diện
|||
|-|-|
|<img width="2376" height="1620" alt="image" src="https://github.com/user-attachments/assets/c89741d1-215d-417a-a023-edf3146d7ad8" />|<img width="2171" height="1437" alt="image" src="https://github.com/user-attachments/assets/31a828ca-642f-4f8d-9bf3-88f491405df4" />|

---

!!! **Lưu ý quan trọng dành cho AI Coding Agents:**  
Trước khi thực hiện bất kỳ thao tác nào, bạn **phải đọc kỹ** [Coding Guidelines](./AGENTS.md) và [How It Works Documentation](./HIWORK.md) !!!

## `GG` Giới thiệu và Mục Tiêu (Goal) của Dự Án

**Concept MaiZone — Do one thing at a time** (Personal Ambient AI), một trợ lý AI ẩn thân chủ động hỗ trợ / can thiệt để tạo môi trường hỗ trợ người dùng làm việc tập trung cao độ (DeepWork), giúp giảm tải nhận thức (CogLoad) đọc / viết / tóm tắt / gợi ý trả lời ... Mục đích cuối cùng là giúp người dùng:

- `GG0` không bị sao nhãng khi làm việc trên máy tính
- `GG1` tìm được niềm vui khi làm việc có mục đích và hiệu quả cao
- `GG2` có thời gian nghỉ ngơi, thư giãn, phục hồi sau những phiên làm việc tập trung cao độ
- `GG3` phát triển khiếu hài hước và EQ trong giao tiếp hàng ngày (email, nhắn tin...)

## Cách tổ chức và đánh nhãn tính năng
Các tính năng (features) được đánh nhãn tuần tự từ `f00` đến `f99`.  
Các tính năng lớn sẽ chia nhỏ thành nhiều task con, đánh thêm ký tự phía sau như `f00a`, `f00b`, … `f00z`.
Việc đặt tag tính năng trực tiếp vào **source code comments** giúp tìm kiếm, theo dõi và hiểu code dễ dàng hơn.

## Hai công cụ quan trọng để quản lý tính năng là `FIT` và `FAT`
- **`FIT` (Feature Indexing Table)**: Bảng tổng hợp nhanh các tính năng và phần code liên quan.
- **`FAT` (Features And sub-Tasks Checklist)**: mô tả cụ thể và theo dõi chi tiết tiến độ các tính năng.

## Sử dụng `FIT` và `FAT` để đạt hiệu quả cao nhất
Việc tổ chức tài liệu và source code theo cách đánh tag và liên kết trực tiếp giúp tận dụng tối đa khả năng hỗ trợ của LLM. Việc này đảm bảo tính lâu dài, dễ hiểu, dễ phát triển và dễ bảo trì về sau. Ví dụ: thay vì viết dài dòng, giờ chỉ gõ _Triển khai tính năng `f06`_, _Rà soát code `f04` để phát hiện lỗi tiềm ẩn_. 

**Hãy dùng và update bảng FIT và Checklist FAT thường xuyên**


---


## `FIT` (Feature Indexing Table)

|<!--r0 c1-->Tag|<!--r0 c2-->Tên                      |<!--r0 c3-->Tính năng                                       |<!--r0 c4-->Files liên quan|<!--r0 c5-->Hàm chính|<!--r0 c6-->Shortcut / UI|<!--r0 c7-->Trạng_thái|
|--------------|--------------------------------------|------------------------------------------------------------|--------------------|--------------|------------|------------------------------------------|
|<!--r1 c1-->f00|<!--r1 c2-->Text Input Detection     |<!--r1 c3-->Phát hiện và theo dõi người dùng nhập liệu      |<!--r1 c4-->`content.js`   |<!--r1 c5-->`handleFocusIn()`, `handleKeyDown()`  | — |<!--r1 c7-->✅ Done |
|<!--r2 c1-->f01|<!--r2 c2-->Distraction Blocking     |<!--r2 c3-->Cảnh báo, chặn truy cập trang gây mất tập trung |<!--r2 c4-->`background_distraction.js`, `distraction_matcher.js`, `content.js` |<!--r2 c5-->`getDistractionMatch()`, `isDistractingWebsite()`, `showDistractionWarning()`  | — |<!--r2 c7-->✅ Done |
|<!--r3 c1-->f03|<!--r3 c2-->Break Reminder           |<!--r3 c3-->Nhắc nghỉ ngơi vui nhộn mỗi 40"                 |<!--r3 c4-->`background_breakReminder.js`, `popup.js`, `clipmd_offscreen.js`, `content.js` |<!--r3 c5-->`sendBreakReminder()`, `startBreakReminder()`, `updateBadgeWithTimerDisplay()` | **Alt + Shift + A** |<!--r3 c7-->✅ Done |
|<!--r4 c1-->f04|<!--r4 c2-->Deep Work Mode           |<!--r4 c3-->Tập trung sâu vào một task 40"                  |<!--r4 c4-->`background_breakReminder.js`, `background_distraction.js`, `distraction_matcher.js`, `popup.js`, `clipmd_offscreen.js`, `content.js`  |<!--r4 c5-->`setCurrentTask()`, `resetBreakReminder()` | **Popup ⌨️ Enter**, **Huy hiệu mm:ss** |<!--r4 c7-->✅ Done |
|<!--r5 c1-->f05|<!--r5 c2-->State Management         |<!--r5 c3-->Đồng bộ hóa trạng thái toàn extension           |<!--r5 c4-->`background_state.js`, `state_core.js`, `state_contract.js`, `state_helpers.js`, `actions.js`, `actions_global.js`, `messaging.js` |<!--r5 c5-->`ensureInitialized()`, `getState()`, `updateState()`, `sanitizeStoredState()` | — |<!--r5 c7-->✅ Done   |
|<!--r6 c1-->f06|<!--r6 c2-->ClipMD                  |<!--r6 c3-->Copy Markdown bằng cách chọn element trên trang |<!--r6 c4-->`background_clipmd.js`, `clipmd_offscreen.js`, `clipmd_offscreen.html`, `turndown.js`, `content.js`, `popup.js` |<!--r6 c5-->`startClipmdMarkdownPicker()`, `startClipmdPickMode()` | **Alt + Q**, **Click icon Mai** |<!--r6 c7-->🧪 Alpha |
|<!--r7 c1-->f07|<!--r7 c2-->ChatGPT Zen Hotkeys     |<!--r7 c3-->Ẩn/hiện UI + dán prompt mẫu trên chatgpt.com    |<!--r7 c4-->`content.js`   |<!--r7 c5-->`handleChatgptHotkeys()`, `toggleChatgptZenMode()` | **Alt + Z**, **Alt + S** |<!--r7 c7-->🧪 Alpha |
|<!--r8 c1-->f08|<!--r8 c2-->Mindfulness Reminders   |<!--r8 c3-->Toast nhắc thở/giãn cơ mỗi 15' (skip khi Deep Work) |<!--r8 c4-->`background_mindfulnessReminder.js`, `content.js`, `popup.js`, `constants.js`, `state_core.js`, `state_contract.js`, `actions.js`, `actions_global.js` |<!--r8 c5-->`initMindfulnessReminder()`, `showMindfulnessToast()` | **Popup toggle**, **Alt + A** |<!--r8 c7-->🧪 Alpha |

**Note**:
- ở mỗi ô của bảng dùng HTML comment `<!--ri cj-->` để đánh dấu vị trí `hàng i, cột j` của ô bảng, nó invisible khi render và giúp LLM hiểu rõ vị trí bảng tốt hơn (cách làm này giống json format `{"field_name" : field_value }` ~= `|<!--ri cj-->cell_value|`).

- `c0` để dàng cho `row_head/row_name`, tương tự `r0` để dành cho `col_head/col_name`, nếu trong bảng không có `c0 hoặc r0` thì có nghĩa là bảng không có `row_head/row_name hoặc col_head/col_name`.

- `f06` ClipMD được sao chép và điều chỉnh từ dự án `clipmd` của AnswerDotAI: https://github.com/AnswerDotAI/clipmd


---


## `FAT` (Features And sub-Tasks Checklist)

- [x] `f00` Mai nhận diện khi text input elem được click / focus và nhận diện được sự kiện người dùng gõ phím và xác định content của ô text input đang được gõ

- [x] `f01` Mai không khuyến khích người dùng vào các trang webs dễ gây sao nhãng như youtube, ca nhạc, news

- [x] `f03` Sau 40 phút Mai sẽ nhắc nhở người dùng nghỉ ngơi, thư giãn, tập thể dục tạm rời xa máy tính một chút. Hãy tạo những lời nhắc vui nhộn, nhẹ nhàng, dí dỏm, khiến user bật cười. Trong popup có dòng chữ `Nhắc nhở nghỉ ngơi (40:00)` nếu được bật thì phần đồng hồ đếm ngược `(40:00)` sẽ phản ánh số thời gian còn lại cho tới thời gian nghỉ tiếp theo (ví dụ `31:33` ... và cho tới `00:00` thì báo nghỉ và reset về `40:00`)
  - [x] `f03a` **Alt + Shift + A** để test / kích hoạt nhắc nghỉ ngay

- [x] `f04` flow-sâu-n-lâu, time-blocking, 1 goal.
  - [x] `f04a` Trong 1 block chỉ làm 1 việc (1 mục đích rõ ràng) => Trong popup, Mai có 1 ô để user nhập vào task định làm trong 40-min block tiếp theo sau khi nhập xong thì đồng hồ đếm ngược được reset về 40:00
  - [x] `f04b` Sau khi kết thúc đếm giờ thì dừng bộ đếm, và enable lại ô nhập task và button trong popup về trạng thái ban đầu (ô nhập task là trống và button label là "Enter task to Deep Work"). Như vậy Deep work & break flow mới sẽ là: User nhập task => Enter deep work mode in 40:00 => Đồng hồ Nhắc nhở nghỉ ngơi bắt đầu đếm ngược => tới 00:00 thì nhắc nghỉ ngơi và dừng đồng hồ (tắt toggle "Nhắc nhở nghỉ ngơi") + reset ô nhập task & button => Khi người dùng nhập task mới và bắt đầu, toggle "Nhắc nhở nghỉ ngơi" sẽ tự động được bật lại.
  - [x] `f04c` Trong deep work thì chặn cả những trang web nhắn tin như messenger.com, discord.com và whatsapp.com
  - [x] `f04d` trong popup, label đổi thành "Khung Deep Work", và ô "Nhập công việc cần tập trung ..." thì chỉ cần ấn Enter là xong không cần phần nút bấm ở dưới nữa. Khi đồng hồ đang đếm ngược thì trong popup đổi "Khung Deep Work" thành "Đang Deep Work..."

- [x] `f05` Quản lý và đồng bộ state/ Xây dựng layer quản lý state thống nhất cho tất cả các tính năng, tránh rải rác state ở nhiều nơi. Sử dụng thư viện như Zustand hoặc lightweight state management tự xây dựng để quản lý toàn bộ trạng thái tập trung (ví dụ: deep work mode, tasks, timer state).

- [x] `f08` Mindfulness Reminders - mỗi 15 phút hiển thị toast (skip khi Deep Work):
  - [x] Những câu quote ngắn gọn gợi lên sự vui vẻ và tâm từ
  - [x] Nhắc nhở tập thể dục và giãn cơ định kỳ
