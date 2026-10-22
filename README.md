# frm-quiz

FRM-Vault 题库的 iPhone 刷题页面。纯静态，题目与进度都从私有仓库 `qiuzan2001/FRM-Vault` 读写，本仓库不含任何题目。

## 使用

1. iPhone Safari 打开 https://qiuzan2001.github.io/frm-quiz/ ，分享 → 「添加到主屏幕」。
2. 打开后到 ⚙︎ 设置页填 token，保存并同步。
3. 今日 / 刷题 / 错题三个 Tab。作答先存在手机，30 秒后或切到后台时上传到 `题库/FRM1/_sync/phone/`。
4. 上传后 GitHub Actions 自动合并进题目并更新进度，几分钟后再点一次同步就能看到；Obsidian 里作答的进度同样会到手机。

## Token

由仓库 owner 创建：GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。
- Repository access：Only select repositories → `FRM-Vault`
- Permissions → Repository permissions → Contents: **Read and write**（Metadata 自动 Read）
- Expiration：选到考试之后

## 开发

`node --test logic.test.js`；本地预览 `python3 -m http.server 8765`。同源文件网络优先（3 秒超时或离线时用缓存），推送后下次打开即生效；换 CDN 库版本时把 `sw.js` 里的 `CACHE` 版本号 +1。
