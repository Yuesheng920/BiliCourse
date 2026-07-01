# BiliCourseProgress

BiliCourseProgress 是一个本地 Chrome 插件，用于在 B 站普通多 P 视频课程页显示学习进度。它会在页面右下角显示一个 B 站主色粉 `#fb7299` 的圆形悬浮按钮，按钮外圈展示当前分 P 的观看进度；悬停或点击后，可以查看整门课程的线性进度、当前分 P 信息和继续观看预测。

插件基于 Chrome Extension Manifest V3，使用原生 HTML / CSS / JavaScript 实现。它不依赖后端服务，不上传任何数据，也不接入第三方统计。

## 功能亮点

- 右下角圆形悬浮按钮，显示当前分 P，例如 `P17`
- 按钮外圈环形进度条表示当前分 P 观看进度：`currentTime / currentVideoDuration`
- 面板横向总进度条表示整门课程线性进度：`已看课程线性时长 / 课程总时长`
- 展示当前分 P、标题、已看时长、总时长、课程进度百分比
- 预测“再看 1h”会到第几 P，以及“再看 5P”还需要多久
- 自动监听 B 站 SPA 路由变化、视频播放状态变化和分 P 列表变化
- 使用 `chrome.storage.local` 按 BV 号保存最近一次本地进度

## v1.1.0 更新内容

- 入口升级为 B 站主色粉 `#fb7299` 的圆形悬浮按钮
- 新增当前分 P 环形进度条
- 切换分 P 时，环形进度会先平滑清空，再过渡到新分 P 进度
- 面板标题升级为 `BiliCourse`
- 主要变量值改为暗灰色 badge / 信息块
- 新增整门课程横向总进度条
- “再看 1h”“再看 5P”升级为预测卡片
- 优化面板圆角、阴影、留白和淡入动画

## 本地安装

1. 下载或克隆本项目
2. 打开 Chrome，进入 `chrome://extensions/`
3. 开启右上角“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择项目文件夹 `bili-course-progress`

加载成功后，打开 B 站普通多 P 视频页即可使用。

## 使用方法

1. 打开 B 站普通多 P 视频，例如 `https://www.bilibili.com/video/BVxxxxxx/?p=2`
2. 页面右下角会出现粉色圆形按钮
3. 鼠标悬停按钮可临时展开进度面板
4. 点击按钮可固定或关闭进度面板
5. 面板中的预测均按视频原始时长计算，不按倍速折算

## 发布与分享

如果只是发给别人使用，推荐直接发送源码文件夹或 GitHub 仓库地址。对方下载后，通过 `chrome://extensions/` 的“加载已解压的扩展程序”加载即可。

建议上传 / 分享这些文件：

```text
bili-course-progress/
├── manifest.json
├── content.js
├── content.css
└── README.md
```

不建议上传 / 分享这些文件：

```text
*.crx
*.pem
.DS_Store
Thumbs.db
node_modules/
dist/
```

当前项目没有构建流程，也不需要 `node_modules`。

## CRX 和 PEM 是什么

`crx` 是 Chrome 扩展的打包文件。你可以把它理解成“安装包”。早期可以直接拖进 Chrome 安装，但现在 Chrome 对非商店来源的 `crx` 限制较多，所以给别人用时，通常不如直接发源码文件夹稳定。

`pem` 是 Chrome 打包扩展时生成的私钥文件。它用于给扩展签名，并决定扩展的固定 ID。

非常重要：

- `pem` 相当于这个扩展的发布私钥
- 不要上传到 GitHub
- 不要发给别人
- 如果你以后要继续用同一个扩展 ID 发布新版本，需要保留同一个 `pem`
- 如果只是本地加载“已解压的扩展程序”，不需要 `crx`，也不需要 `pem`

所以，开源到 GitHub 时，通常只提交源码，不提交 `crx` 和 `pem`。

## GitHub 上传建议

推荐仓库结构：

```text
bili-course-progress/
├── manifest.json
├── content.js
├── content.css
├── README.md
└── .gitignore
```

建议 `.gitignore` 包含：

```gitignore
*.crx
*.pem
.DS_Store
Thumbs.db
node_modules/
dist/
```

如果你想提供下载版本，可以在 GitHub Releases 里上传一个 zip 包。zip 包里放源码文件即可，不要放 `pem`。

## 已知限制

- 主要支持普通 B 站多 P 视频页
- 不保证支持番剧、课程付费页、合集页、播放列表页
- B 站页面结构变化可能导致分 P 列表解析失败
- 预测按视频原始时长计算，不按播放倍速折算

## 隐私说明

- 数据只保存在本地 `chrome.storage.local`
- 不上传任何用户数据
- 不请求无关网络接口
- 不接入第三方统计服务

## 截图

可在这里补充本地加载后的截图：

- 圆形悬浮按钮截图
- 展开后的进度面板截图
