# OpenReview 文档阅读界面

公开根页面在服务端读取 README.md，客户端沿用 Streamdown 2.4.0 的静态 Markdown、Shiki、Mermaid、数学与 CJK 插件。阅读布局、PageHeader、按钮、选择器及表格/图谱大视图采用 XSEC 的 Beui 设计规范。服务端 GitHub App、Provider 和 Workflow 继续使用现有接口。

系统颜色由公共 design-tokens 生成 CSS，服务端首屏即可呈现对应配色。客户端通过 useSyncExternalStore 订阅颜色和减少动效设置，并释放监听。共享 ControlThemeProvider 为控件和 body 弹层提供同一偏好；减少动效样式覆盖所有主题作用域。目录从实际渲染的二级标题生成，锚点由标题文字生成，当前位置来自 URL fragment。

Streamdown 的图片包装为 div。包含部署徽标的段落使用合法块容器，浏览器解析与客户端渲染保持同一结构。当前版本的 Streamdown memo 比较忽略 Mermaid 配置变更；图谱边界从公共主题读取配色，通过公开 StreamdownContext 提供配置，保留缩放和弹层状态。升级 renderer 时应继续验证真实 SVG 颜色与状态保持。

代码与表格采用公共按钮，复制失败显式显示，下载反馈表示请求已发起。表格保留 Markdown、CSV、TSV 格式，数据由实际 DOM 与 Streamdown 的公开转换函数提取。代码/表格横向滚动区域具有可读名称和键盘焦点。大视图采用公共 Dialog，Base UI 维护焦点约束、Escape 与触发器焦点恢复；图谱继续使用原有缩放、平移及 SVG/PNG/MMD 导出引擎。

## 依赖

固定 vendor 包为 @xsec/design-tokens 0.1.1 和 @xsec/ui-react 0.1.3，导出编译后的 JavaScript。Bun 1.3.9 通过本地 file override 解析 tokens peer dependency；锁文件保留既有依赖版本。vendor 内的许可证与第三方声明随包保留，安装复用已有 Bun hardlink cache。

## 验证

本机为 macOS arm64，使用项目固定 Bun 1.3.9、Next 16.1.6、React 19.2.3 与实际生产 Chromium。Browser 插件不可用，复用现有 Playwright。

候选真实验证包括冻结安装、受影响 lint、生产构建和 TypeScript；公开阅读、实际剪贴板/拒绝权限、下载文件内容、目录/跳转焦点、Markdown/CSV/TSV、实际 Mermaid、横向键盘滚动、无 JavaScript 的 SSR，六组桌面/平板/手机及 125%/200% 字号布局；另检查四个桌面/触屏大视图和 light/dark/light SVG 颜色、缩放保持与减少动效。

完整 `bun run check` 的已知基线为 lib/utils.ts 格式问题，本批受影响文件检查单独执行。正常页面控制台的本地 Vercel Analytics/SpeedInsights 404 与页面异常分别记录。

实际入口：`rtk node <证据目录>/run.mjs candidate-v11 ui-pipeline.mjs --wait-slot`。共享资源入口执行 status、changed plan 和单次 exec；等候构建槽是有界只读操作。冻结源码/制品、AB/BA 性能、主仓回读及清理结果由最终 acceptance-state.json 记录。

证据目录：`/Users/xiaosong/.codex/visualizations/2026/10/02/01a0faad-6517-7cd3-90b5-b818bc64660d/openreview-reading-ui`。

## 回滚与范围

回退本批产品提交，并依照原锁文件重建即可恢复原阅读界面。此批没有持久化数据迁移。真实 Provider/GitHub/Workflow 执行、托管部署、Safari/Firefox、其他系统/架构、屏幕阅读器及 README 未包含的数学/CJK 示例继续分别验收。
