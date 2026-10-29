# CrossDeviceResume 子会话调查

核查时间：2026-10-29（Asia/Shanghai）。资料核查部分为只读取证；文末另记录主执行器的临时设置对照实验，其原值已恢复。未持久更改 Windows 策略、远控配置或系统包。

## 已核实的事实

### 官方策略为用户级，且需重启

Microsoft Policy CSP 的 Connectivity / DisableCrossDeviceResume 条目明确声明：

- Scope 为 User，Device 不适用。
- URI 为 `./User/Vendor/MSFT/Policy/Config/Connectivity/DisableCrossDeviceResume`。
- Windows 11 24H2（10.0.26100）及之后版本；Pro / Enterprise / Education / IoT Enterprise。
- `0` 启用续接（默认）；`1` 关闭续接。
- 文档明确要求策略变更在重启后生效。
- 文档描述的功能效果为停止接收 CrossDeviceResume 通知，并未承诺修复 AppX 容器附加失败。

来源：[Microsoft Policy CSP – Connectivity](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-connectivity#disablecrossdeviceresume)。2026-10-29 通过 HTTPS 直接读取并核对上述条目。

同一 Windows 用户的主桌面与子桌面不应被当成两个独立用户策略范围。因此该开关不能被描述成“仅关闭子会话、主桌面不受影响”。该条目也未给出 ADMX 注册表映射；不能凭空选一个 `PolicyManager` 注册表路径并宣称实现了 CSP 部署。

### 本机 shell 扩展声明确实引用该策略

只读检查本机：

`C:\Windows\SystemApps\MicrosoftWindows.Client.CBS_cw5n1h2txyewy\AppxManifest.xml`

包名 `MicrosoftWindows.Client.CBS`，`Get-AppxPackage` 报告 `Status = Ok`。

清单第 652–661 行的 `com.microsoft.windows.extension.shelluihost` / `CrossDeviceResumeHost` 扩展包含：

```xml
<LaunchPolicy>1</LaunchPolicy>
<LogonPolicy>0</LogonPolicy>
<LaunchTimeoutPolicy>1</LaunchTimeoutPolicy>
<MdmPolicyArea>Connectivity</MdmPolicyArea>
<MdmPolicyName>DisableCrossDeviceResume</MdmPolicyName>
<MdmPolicyEnabledBehavior>0</MdmPolicyEnabledBehavior>
<DisableOnSKUCategories>3</DisableOnSKUCategories>
<ConfigVelocityDisableFeatureId>62080118</ConfigVelocityDisableFeatureId>
```

相邻 `CrossDeviceResumeService` 扩展也引用相同 MDM 策略。

这使“官方策略可能影响 shell 扩展激活”成为有实物依据的假设，但未验证私有字段的完整解释、缓存时机或失败处理。不能据此直接推导 undocumented registry 写法、临时修改即时有效、或插件可安全撤销生效状态。

### IsResumeAllowed 不能直接作为宿主抑制保证

本机读取：

`HKCU\Software\Microsoft\Windows\CurrentVersion\CrossDeviceResume\Configuration\IsResumeAllowed = 1`

本轮未发现 Microsoft 官方文档保证将此值改为 `0` 会阻止 explorer 创建 `CrossDeviceResumeHost` 进程。关闭功能或通知与阻止 shell 启动并不等价。不能把该修改写进产品当成已验证的弹窗修复。

## 暂未建立的结论

- 未找到 Microsoft 文档支持的、按单个 Windows session 禁止此 shell host 的接口。
- 不能证明 UAC、360、防病毒状态或 ACL 是本问题根因；需要有控制变量的复现。
- `ShellUIHosts` 会话键存在而没有 ProcessId，不足以证明启动失败。
- 不能将每 15 分钟的 WebExperience 错误和 CrossDeviceResume 的一次性启动错误合并统计。
- 未执行策略修改、注册表修改、注销、重启或包卸载。

这里“未找到”限定于本轮官方文档和本机清单核查，不能证明所有内部实现均不存在会话级抑制机制。

## 可执行的对照实验

先确保真实子会话能够可靠关闭并确认清理；每次只创建一个本插件拥有的子会话。

1. 保持现有用户设置，记录宿主 PID、session ID、起止时间、AppModel-Runtime/Admin 日志位置，以及 CrossDeviceResume 对应的 208/212 事件。单独排除 WebExperience。
2. 在相同 Windows 版本、同一用户和相同插件代码上重建一次子会话，确认症状是否复现。没有阳性基线就不宣称后续变化有因果效果。
3. 如果测试 `IsResumeAllowed=0`，将它明确标记为未验证实验，先保存值、类型与键是否原本存在；只改这一变量，进行完整的新子会话创建；比较弹窗、host 进程和对应日志。恢复原值不代表已恢复 shell 的缓存状态，应记录这一限制。该设置影响同用户主桌面功能，应提前取得明确授权。
4. 如果测试官方 CSP，使用受支持的用户策略部署方式，明确说明会影响该用户并需要重启。重启与暂时影响主桌面续接均需明确安排，不应自动执行或伪装成免重启的插件内部修复。
5. 同时验证原本主桌面的功能和会话未被错误注销。将结果分别写成：症状消失、错误事件消失、功能开关生效、完整原因解释；这些是不同强度的结论。

在完成上述验证前，建议交付已验证的会话失效恢复逻辑，并把弹窗问题保留为未解决，不添加未经验证的全局系统改动。

## UU 远程补充核查

已直接读取网易官方：

- [UU 远程帮助首页](https://uuyc.163.com/help/)
- [常见问题](https://uuyc.163.com/help/questions/)
- [功能教程](https://uuyc.163.com/help/guidelines/)
- [如何反馈问题](https://uuyc.163.com/help/20241203/40221_1197735.html)

本轮上述官方帮助列表未发现“固定 Windows console session”或“选择 WTS 登录会话”的公开设置说明。这不等于客户端没有相关未公开选项，也不能将显示器切换当作登录会话切换。

官方反馈路径已核实：PC 客户端右上角菜单 → 使用帮助 → 帮助与反馈；移动端主页 → 我的 → 帮助与反馈 / 在线客服。

没有证据证明禁用 RDP listener、修改 RDP 远程登录权限能控制 GameViewer 服务选择哪个桌面。GameViewer 进入某会话的进程证据也不等于已经知道它的选择算法。不要通过杀 GameViewerServer、停止服务或批量注销会话来试图修复；这可能直接中断用户需要的主桌面远控。

给 UU 的有效报告应包括：主会话与插件子会话的 ID、父子关系、建立时间、GameViewerServer 各实例的 session ID、远程接入实际落点，以及关闭仅本插件子会话后的对照结果。不包含 Windows 密码、DPAPI 内容、访问令牌或远控验证码。

## 同轮主执行器提供的实测负结果

2026-10-29，主执行器在完成子会话失效恢复测试后，对 `IsResumeAllowed=0` 做了真实新建子会话对照；不是只检查注册表值。

- 试验目标子会话：session 7。
- 设置为 `0` 后，新子会话仍产生两条 CBS 208 / `0x80070005`：
  - `2026-10-29T06:48:51.487Z`（上海时间 14:48:51.487）。
  - `2026-10-29T06:48:53.952Z`（上海时间 14:48:53.952）。
- 主执行器报告已在 finally 中恢复原值 `1`。

因此这个开关在本机、本次启动场景下不能消除对应的 CBS 容器启动错误，不能作为已解决弹窗的实现。上面的实验建议第 3 步已经得到负结果，不需要重复。这个负结果不等于证明官方 `DisableCrossDeviceResume` CSP 也无效；它们不能混为同一个已验证机制。

同期主执行器还报告真实恢复验证通过：注销本次拥有的 session 5 → 收到旧 host 的清理确认 → 新建 session 6 → `list_displays` 成功。此结果证明恢复路径，不证明 CrossDeviceResume 或 UU 落点问题已解决。

## 后续授权实验：用户级 CSP 的部署路径核查

用户随后明确授权影响主桌面续接并安排重启。本节仍仅记录研究，没有执行系统变更。

### 本机 WMI Bridge 不具备这个策略的投影

本机只读枚举 `root\cimv2\mdm\dmmap` 的 Connectivity 相关类，存在：

- `MDM_Policy_Config01_Connectivity02`
- `MDM_Policy_Result01_Connectivity02`

两者均没有 `DisableCrossDeviceResume` 属性；Config 类 `InPartition` 值为 `local-system`。遍历所有 Policy 类也没有找到该属性。因此不能对该类传入一个虚构属性；不能由设备类写入冒充用户级策略。

[Microsoft 的 WMI Bridge PowerShell 文档](https://learn.microsoft.com/en-us/windows/client-management/using-powershell-scripting-with-the-wmi-bridge-provider)明确区分：设备类需 `InPartition("local-system")`，用户类需 `InPartition("local-user")`；不同用户场景必须通过 MI custom context 指定 `PolicyPlatformContext_PrincipalContext_Type` 与 `PolicyPlatformContext_PrincipalContext_Id`。本机缺失相应类和属性，不能通过切换运行身份弥补 schema 缺失。

### 有官方头文件与示例的本地管理 API

Microsoft 官方 Windows SDK 元数据仓库的[完整头文件 mdmlocalmanagement.h](https://raw.githubusercontent.com/microsoft/win32metadata/main/generation/WinSDK/RecompiledIdlHeaders/um/mdmlocalmanagement.h)声明：

```cpp
HRESULT RegisterDeviceWithLocalManagement(BOOL* alreadyRegistered);
HRESULT ApplyLocalManagementSyncML(PCWSTR syncMLRequest, PWSTR* syncMLResult);
HRESULT UnregisterDeviceWithLocalManagement();
```

实际头文件使用 `STDAPI`（HRESULT / Windows 调用约定）。头文件受 `NTDDI_VERSION >= NTDDI_WIN10_RS2` 及 `WINAPI_FAMILY_PARTITION(WINAPI_PARTITION_DESKTOP)` 保护，没有在此处限定为 IoT SKU。

头文件契约：

- 已注册时，`RegisterDeviceWithLocalManagement` 返回 `S_OK` 且 `alreadyRegistered=TRUE`；其他情况输出参数为 FALSE，仍须检查 HRESULT 是否失败。
- 调用 Apply 前必须先调用 Register。
- Apply 的返回结果是分配的 UTF-16 字符串指针，调用者必须用 `LocalFree` 释放。
- 此头文件没有 `IsDeviceRegisteredWithLocalManagement`。不要猜测导出或签名。

[Microsoft 官方 IoT 客户端的 MdmProvision.cpp](https://raw.githubusercontent.com/ms-iot/iot-core-azure-dm-client/master/src/SystemConfigurator/CSPs/MdmProvision.cpp)包含实际调用：

1. `RegisterDeviceWithLocalManagement(NULL)`。
2. `ApplyLocalManagementSyncML(requestSyncML.c_str(), &output)`。
3. 拷贝结果后 `LocalFree(output)`。
4. 解析所有返回 `SyncML/SyncBody/Status/Data`，任何代码 >= 300 均当作失败，不能只根据 HRESULT 成功判断策略写入成功。

示例的输入是 `<SyncBody>...</SyncBody>` 片段，包含 `Get` / `Replace` / `Delete` 等命令。必须保存完整返回状态用于判断，而非仅取第一个 Data。

注意：该官方示例虽然函数带名为 `sid` 的参数，但 `RunSyncML(const wstring&, ...)` 实际忽略了此参数。因此它不能证明用户级 URI 的支持方式，或证明从 SYSTEM 执行会作用到 Laptop 用户。头文件的 Desktop 范围也不等同于所有 CSP / User 节点均受到该 API 支持。

本轮尝试 Learn 的 `/windows/win32/api/mdmlocalmanagement/nf-mdmlocalmanagement-*` URL 返回 404，不能把这些不存在的页面作为参考。以上签名依据官方头文件和源码，而非第三方博客。

### 受控验证与回退要求

先做 Get 探测，不在 Get 失败时改写 PolicyManager 注册表来伪造成功。对应目标为官方公布的：

`./User/Vendor/MSFT/Policy/Config/Connectivity/DisableCrossDeviceResume`

按官方示例形状构造只读命令（执行前仍必须注册）：

```xml
<SyncBody>
  <Get>
    <CmdID>1</CmdID>
    <Item>
      <Target><LocURI>./User/Vendor/MSFT/Policy/Config/Connectivity/DisableCrossDeviceResume</LocURI></Target>
    </Item>
  </Get>
</SyncBody>
```

`RegisterDeviceWithLocalManagement` 本身可能创建注册，因此“先注册再 Get”整体不是纯只读。只有注册成功且 `alreadyRegistered=FALSE`，才记录为本次拥有的临时注册；已有注册绝不能在结束时注销。

若 Get 返回明确的用户策略结果，必须先存档原始值以及“未配置”状态，再考虑按 CSP 文档允许的 Add / Replace 部署 `int` 值 `1`。写后再次 Get、核对目标用户及有效状态，再进入重启验证；单独看到 HKLM default 值不是有效策略验证。

回退须保持原始状态：原先已配置则恢复原值，原先未配置则 Delete 本次策略；二者不能一律写 0。解析回退的 SyncML 状态并 Get 确认，然后才注销本次拥有的 local registration。不要在需要重启验证的有效设置仍依赖该注册时，先注销再宣称设置会继续存在。注销如何影响策略持久性也应实测，不能假设。

如果 User Get 返回 unsupported / not found / access denied，先报告该路径在此上下文不可用，保留原始错误；不能伪称已经成功关闭功能。是否需要变换到目标用户上下文，必须有独立依据或单变量实验支持。

## 重启后继续调查：官方 PiP 已知问题与容器失败

用户已要求暂缓 UU，本轮未读取或修改 UU 配置。

### 找到直接匹配症状的 Microsoft 官方已知问题

[Power Automate for desktop：Run desktop flows in picture-in-picture](https://learn.microsoft.com/en-us/power-automate/desktop-flows/run-desktop-flows-pip) 的 Known issues / Limitations of child session mode 明确记录：新开 PiP 子会话后出现 Windows 无法访问设备、路径或文件的错误，可能由 Mobile Devices service 引起；该服务与 child sessions 不兼容。文档建议关闭该服务作为解决途径。

同一页面还说明：登录启动应用会在子会话再次运行，主子会话同时运行两个实例可能冲突；部分应用不能在主子会话同时打开。因此“普通登录启动链与子会话兼容性问题”已有官方依据。但文档并未给出本机这个 `CrossDeviceResume.exe` 的 ContainerId 失败的完整内部原因，不能直接把所有应用容器 access denied 都归到此原因。

### Mobile Devices service 的具体对象尚未确认

本机只读结果：

- 未发现名为 CrossDevice 的 SCM 服务。
- `CDPSvc` 与 `CDPUserSvc_*` 的中文显示名为连接设备平台服务和连接设备平台用户服务；不能仅凭名称相近就等同 Mobile Devices service。
- `MicrosoftWindows.CrossDevice_0.26092.74.0_x64__cw5n1h2txyewy` 为本机安装的 stub 包，状态 Ok；其 AppxManifest 未声明 `windows.startupTask`。
- CBS 清单中的 `CrossDeviceResumeService` 是 shellhost component：执行 `shellhost.exe LoadComponent CrossDeviceResumeService --boolProperties loadFullComponent true`；这是 shell 扩展激活层，不是已确认的 SCM service 名称。
- 未在上述 CrossDevice AppModel SystemAppData 子树发现名为 startupTask 的注册。

因此官方 PiP 限制是强相关的排查方向，但尚不能提供“停止 CDPSvc 就能修复”的结论。官方页没有写出 service 精确名称或操作步骤，具体关闭对象需要额外识别。不得通过盲停所有移动设备相关服务进行替代。

### 重启与策略实验的新结果

主执行器报告：重启后使用实验 PolicyManager 用户值 1 仍复现，已经回退。新的事件链显示：212 为 DesktopAppXContainer attach `0x80070005`，随后 208 指向 CBS 的 `CrossDeviceResume.exe`，二者关联同一新建 ContainerId。另一次 session 3 得到该程序成功事件 201 且没有 CBS208，而重启后的 session 2 曾失败。

这说明错误不是每次创建子会话都必现；一次成功不能证明修复。容器身份、包状态、主子会话中的进程启动顺序和并发应被列为待测变量。同期 Teams / AMD 等不同包的 attach denied 需要按 package identity、ContainerId 和 session 分组，不能当作 CrossDeviceResume 同一个失败。

### NamedPolicy 的值与管理状态不能混为一谈

Microsoft 官方 API 文档分别定义：

- [NamedPolicyData.IsManaged](https://learn.microsoft.com/en-us/uwp/api/windows.management.policies.namedpolicydata.ismanaged?view=winrt-26100)：说明该 MDM policy 是否正在受管理；False 表示未受管理。
- [NamedPolicyData.GetBoolean](https://learn.microsoft.com/en-us/uwp/api/windows.management.policies.namedpolicydata.getboolean?view=winrt-26100)：返回策略值的布尔表示。

故 `GetBoolean()==true` 加 `IsManaged==false` 不等于“该策略已通过管理路径部署并被 shell 强制执行”。实验失败能否证的是本次部署方法；不能仅凭这两个读数宣布官方 CSP 实现有问题。本轮未找到 shellhost 公开源码证明它使用哪个判断分支，不能臆造其具体忽略逻辑。

### 当前证据边界

没有找到 Microsoft 公开支持的单个 session 禁用 `shelluihost/CrossDeviceResumeHost` 接口，也没有找到 DesktopAppXContainer/AppSilo 以此错误码失败的公开根因表。`0x80070005` 是通用拒绝访问，并不能单凭错误码推导“包已损坏”“主子会话共享同一 silo”或“必须调整 ACL”。不建议为了解决此问题修改 CBS 包、包目录权限或加载 shell 的私有注册表键。

有效的下一步是保留成败两次追踪，对照同 package、同应用的父/子进程、session、ContainerId 与激活时序；必要时通过 Microsoft 支持提交最小复现和 ETW。Mobile Devices service 的官方绕过应在精确识别对象后做单变量验证。
