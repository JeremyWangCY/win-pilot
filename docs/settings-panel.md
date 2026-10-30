# Win-Pilot 设置面板

面板共五项，放在一个紧凑面板里，无需滚动即可全部看到：三个开关（显示操作光标、动作进行中显示状态条、浏览器后台运行）和两个带图标的分段控件（运行位置：当前桌面 / 独立任务窗口；远程控制接入时：改用当前桌面 / 停止并提示）。卡片只有控件标签和状态信息，不放介绍、分组标题或说明段落。底部一行左侧是运行版本（有新版时显示“重新加载”），右侧是未保存数量、放弃和保存。已覆盖的项显示徽标和图标式“恢复默认”按钮。界面语言跟随宿主语言，每个控件都有可见标签与无障碍名称；颜色取自宿主主题变量，深浅色主题均适用。

当前宿主要求 DeepSeek Harness 0.2.0-rc.2 或更新版本，并提供 `configForms`、`plugins.bundle.config` 和 `settings.section`。插件只导出三个标记为 `volatile()` 的布尔 Config 字段，不再注册旧命名空间、读取 `settingsScope` 或挂载旧 Plugins 槽位。表单依据宿主描述的 Loader entry id 绑定，支持 `win-pilot` 和 `include:win-pilot` 的当前入口。保存和恢复默认被拒绝时保留草稿并显示失败；控制器更新会刷新页面。

参见 [桌面控制契约](desktop-control-contract.md) 和 [输入中断要求](input-interruption.md)：后台输入、锁屏检查、用户输入中断、焦点让路和默认读取窗口文字遵循本产品自己的契约。浏览器通道是独立能力，不假设它与其他产品的浏览器偏好存在对应关系。

宿主的 schemastery 必须支持真实 volatile 引用（已核对 3.18.4）；3.18.2 上添加元数据不会带来热更新。独立 CLI/MCP 安装无需宿主依赖，仍可使用内部默认值。

`settings-integration.check.mjs` 使用真实 schemastery/cosmokit 验证 Config 投射形状和引用热更新；这不等同于完整桌面 Loader/表单集成。旧 APPDATA runtime 的 `settings.register` 不代表当前 Electron ASAR 中的宿主，因此不再作为当前集成通过的证据。
