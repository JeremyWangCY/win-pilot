# Win-Pilot 设置面板

面板仅保留三个勾选项：显示操作光标、显示运行状态提示、浏览器在后台运行。数值参数和输入策略使用内部默认值；旧配置无法覆盖。必要的 Windows/Meta 系统按键能力始终开启。

当前宿主要求 DeepSeek Harness 0.2.0-rc.2 或更新版本，并提供 `configForms`、`plugins.bundle.config` 和 `settings.section`。插件只导出三个标记为 `volatile()` 的布尔 Config 字段，不再注册旧命名空间、读取 `settingsScope` 或挂载旧 Plugins 槽位。表单依据宿主描述的 Loader entry id 绑定，支持 `win-pilot` 和 `include:win-pilot` 的当前入口。保存和恢复默认被拒绝时保留草稿并显示失败；控制器更新会刷新页面。

参见 [桌面控制契约](desktop-control-contract.md) 和 [输入中断要求](input-interruption.md)：后台输入、锁屏检查、用户输入中断、焦点让路和默认读取窗口文字遵循本产品自己的契约。浏览器通道是独立能力，不假设它与其他产品的浏览器偏好存在对应关系。

宿主的 schemastery 必须支持真实 volatile 引用（已核对 3.18.4）；3.18.2 上添加元数据不会带来热更新。独立 CLI/MCP 安装无需宿主依赖，仍可使用内部默认值。

`settings-integration.check.mjs` 使用真实 schemastery/cosmokit 验证 Config 投射形状和引用热更新；这不等同于完整桌面 Loader/表单集成。旧 APPDATA runtime 的 `settings.register` 不代表当前 Electron ASAR 中的宿主，因此不再作为当前集成通过的证据。
