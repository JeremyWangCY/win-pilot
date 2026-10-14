# -*- coding: utf-8 -*-
# Build the Win-Pilot overnight test report as a .pptx.
# Times are the numbers actually recorded during this session: estimates given
# before each task, actuals measured, and every overrun with its cause + remedy.
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

OUT = r"C:\Users\Laptop\win-pilot\reports\win-pilot-overnight-report.pptx"
ACCENT = RGBColor(0x1A, 0x73, 0xE8)
INK = RGBColor(0x20, 0x21, 0x24)
MUTED = RGBColor(0x5F, 0x63, 0x68)
GREEN = RGBColor(0x18, 0x80, 0x49)
RED = RGBColor(0xC5, 0x22, 0x1F)

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]

def slide():
    return prs.slides.add_slide(BLANK)

def box(s, l, t, w, h):
    tb = s.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tb.text_frame.word_wrap = True
    return tb.text_frame

def setp(p, text, size=18, bold=False, color=INK, space_after=6):
    p.text = text
    p.space_after = Pt(space_after)
    f = p.runs[0].font if p.runs else p.font
    for r in (p.runs or [p]):
        r.font.name = 'Microsoft YaHei'
    f.size = Pt(size)
    f.bold = bold
    f.color.rgb = color
    return p

def title_bar(s, text, sub=None):
    tf = box(s, 0.6, 0.35, 12.1, 1.1)
    setp(tf.paragraphs[0], text, 30, True)
    if sub:
        p = tf.add_paragraph()
        setp(p, sub, 14, False, MUTED)

# ---- S1 cover -------------------------------------------------------------
s = slide()
tf = box(s, 1.0, 2.5, 11.3, 2.6)
setp(tf.paragraphs[0], 'Win-Pilot 夜间自动化测试报告', 40, True)
p = tf.add_paragraph(); setp(p, '测试日期 2026-10-13 晚 — 2026-10-14 晨　·　执行人: AI Agent (DeepSeek Harness × win-pilot)', 16, False, MUTED)
p = tf.add_paragraph(); setp(p, '成果: 1 个致命崩溃修复 · 2 个隐性 API 错误修复 · 7 类窗口实测矩阵 · 1 个带判别力的回归测试', 16, False, ACCENT)

# ---- S2 summary -----------------------------------------------------------
s = slide()
title_bar(s, '做了什么（摘要）', '全部改动均已用真实运行验证，不是 mock')
tf = box(s, 0.6, 1.7, 12.1, 5.3)
items = [
    ('① 设置面板修复（0.1.9，已发布）', '设置 → 插件 里出现「Win-Pilot 电脑操作」标签页', GREEN),
    ('② 修复致命崩溃', '读 Chromium/Electron 选中文字时 0xC0000005 进程死亡 → A/B 证明修复有效', GREEN),
    ('③ 修复 2 处隐性 API 命名错误', '枚举命名空间写错会被 catch 静默吞掉，表面上"正常"实际返回空', GREEN),
    ('④ 实测矩阵', 'DSH / Edge / Feishu / explorer / 系统设置 / TabTip / Doubao — 7 类窗口 0 崩溃', GREEN),
    ('⑤ 回归测试', '页面自动选中文字 → 读回 37 字符；故意还原 bug 后测试立刻报错（有判别力）', GREEN),
]
first = True
for head, detail, _ in items:
    p = tf.paragraphs[0] if first else tf.add_paragraph(); first = False
    setp(p, head, 20, True)
    p = tf.add_paragraph(); setp(p, detail, 16, False, MUTED)

# ---- S3 time ledger -------------------------------------------------------
s = slide()
title_bar(s, '时间账本（预估 vs 实际，单位: 分钟）', '原则: 每项动手前先给预估；超时必须说明原因与对策')
rows = [
    ('任务', '预估', '实际', '超时原因 → 对策'),
    ('定位设置卡片不可见', '180', '240', '注册槽位选错(看不到的 section) → 改用 live slot 工具看真实渲染'),
    ('复现 UIA 崩溃', '8', '20', '探针只测了 root 元素 → 按代码真实 fallback 路径测'),
    ('根因定位', '20', '35', '崩溃须逐步隔离进程 → 每步一个子进程二分'),
    ('实施修复+验证', '15', '30', '枚举名写错被吞成"假成功" → 静态断言+非空选中前置'),
    ('编写回归测试', '20', '60', 'Ctrl+A 不可达 / CJK JSON 编码 / 清理竞态 三连障碍 → 逐一换方案'),
    ('全量测试+提交发布', '25', '25', '后台并行执行，未超时'),
]
headers = rows[0]
col_x = [0.6, 5.4, 6.3, 7.2]
col_w = [4.7, 0.8, 0.8, 5.9]
row_y = 1.8
for c, h in enumerate(headers):
    tf = box(s, col_x[c], row_y, col_w[c], 0.4)
    setp(tf.paragraphs[0], h, 15, True, ACCENT)
row_y += 0.44
for r in rows[1:]:
    for c in range(4):
        is_last = r is rows[-1]
        color = GREEN if (c in (1, 2) and is_last) else INK
        tf = box(s, col_x[c], row_y, col_w[c], 0.62)
        p = tf.paragraphs[0]
        setp(p, r[c], 13, c == 0, color, 0)
        p.line_spacing = 1.0
    row_y += 0.62
p = box(s, 0.6, 6.55, 12.1, 0.5).paragraphs[0]
setp(p, '总账: 预估 268 分钟 → 实际约 410 分钟 (超时 53%)。超时主因不是方向错，而是"表面成功"反复出现。',
     15, True)

# ---- S4 the crash fix -----------------------------------------------------
s = slide()
title_bar(s, '主修: 读选中文字导致进程崩溃', '缺陷存在两夜: 任何 Chromium 窗口上 get_window_state 一律失败')
tf = box(s, 0.6, 1.6, 12.1, 1.2)
setp(tf.paragraphs[0], '机理: Chromium 的 UIA TextPattern.GetSelection() 返回的 range 对象内核句柄损坏 — 对它调 GetText() 即触发 0xC0000005。原生访问违例不归 try/catch 管，所以原有保护形同虚设。', 16)
rows = [('', 'exit code', '结果'),
        ('0.1.7 旧代码 · 有选中文字的 Edge 窗口', '-1073741819', '崩溃'),
        ('修复后 · 同一窗口', '0', '成功，元素 59 个'),
        ('变异测试 · 故意还原 bug', '-1073741819', '测试立刻抓住')]
y = 3.0
for i, r in enumerate(rows):
    xs = [0.6, 5.0, 7.4]
    ws = [4.3, 2.3, 5.6]
    for c in range(3):
        tf = box(s, xs[c], y, ws[c], 0.5)
        bold = (i == 0)
        color = ACCENT if i == 0 else (RED if '崩溃' in r[2] else GREEN)
        setp(tf.paragraphs[0], r[c], 15, bold or c == 2, ACCENT if i == 0 else (RED if '崩溃' in r[2] else INK), 0)
    y += 0.52
tf = box(s, 0.6, 5.4, 12.1, 1.6)
setp(tf.paragraphs[0], '修法: 不碰选区对象 — 复制 DocumentRange，把两端挪到选区端点，再 GetText()。', 16, True)
p = tf.add_paragraph(); setp(p, '为什么之前没发现: 空选区不会崩，只有真的选中了文字才崩 —— 早期夹具没造选择，测试空转。', 14, False, MUTED)

# ---- S5 hidden enum bug ---------------------------------------------------
s = slide()
title_bar(s, '连带修复: 写错枚举名，catch 吞掉后"假成功"', '比崩溃更危险的一类 bug: 不崩、不报错、就是悄悄拿不到数据')
tf = box(s, 0.6, 1.7, 12.1, 5.2)
lines = [
    ('现象', '修复"不崩了"，但 selected_text 永远是空'),
    ('根因', '[System.Windows.Automation.TextPatternRangeEndpoint] 少写一层 .Text 命名空间'),
    ('链条', 'MoveEndpointByRange 每次抛异常 → 外面 catch {} 吞掉 → 返回空字符串'),
    ('发现者', '正是新写的回归测试: 它坚持"必须读到非空选中"才肯通过，假成功无处藏身'),
    ('波及', '同款错误在源码里共 6 处(选区读取 + select_text 内容搜索)，已全部改为正确命名空间'),
    ('教训', '不能只断言"没崩": 需要同时断言功能语义(拿到 37 字符)才算真测试'),
]
first = True
for k, v in lines:
    p = tf.paragraphs[0] if first else tf.add_paragraph(); first = False
    setp(p, f'{k}: ', 18, True, ACCENT, 2)
    p2 = tf.add_paragraph(); setp(p2, v, 16, False, INK, 10)

# ---- S6 test matrix -------------------------------------------------------
s = slide()
title_bar(s, '实测矩阵: 7 类窗口 0 崩溃', '方法: 对每个窗口注入 include_text 读文档+选区，逐个真实窗口执行')
rows = [
    ('窗口类型', '元素数', '文档文本', '选区', '状态'),
    ('DSH 本体 (Electron)', '555', '3000 字', '0 字', '通过'),
    ('Edge 夹具 (Chromium)', '59', '582 字', '37 字', '通过'),
    ('飞书 (Electron)', '497', '23 字', '0 字', '通过'),
    ('explorer (Win32)', '0', '-', '-', '通过(无UIA文本)'),
    ('系统设置 (UWP)', '0', '-', '-', '通过(无UIA文本)'),
    ('TabTip 手写面板', '0', '-', '-', '通过(无UIA文本)'),
    ('豆包 (Electron)', '4', '0 字', '0 字', '通过'),
]
xs = [0.6, 4.4, 6.0, 8.0, 9.6]; ws = [3.7, 1.5, 1.9, 1.5, 3.1]
y = 1.8
for i, r in enumerate(rows):
    for c in range(5):
        tf = box(s, xs[c], y, ws[c], 0.45)
        setp(tf.paragraphs[0], r[c], 14 if i else 15, i == 0, ACCENT if i == 0 else INK, 0)
    y += 0.47
p = box(s, 0.6, y + 0.2, 12.1, 0.5).paragraphs[0]
setp(p, '注: explorer/设置/TabTip 本就不暴露 UIA 文本树，返回空属预期，不算缺陷。', 13, False, MUTED)

# ---- S7 retrospective -----------------------------------------------------
s = slide()
title_bar(s, '超时复盘与持续优化', '同一个根源反复出现: 验证手段不对，导致"看起来成功"')
rows = [
    ('浪费点', '代价', '已落实的优化'),
    ('测错元素(recon 阶段想当然)', '~40 分钟', '永远测代码真实走的路径，不测"我以为的入口"'),
    ('每步必须隔离子进程', '~15 分钟', '沉淀可复用的 per-process 探针脚本，下次直接用'),
    ('catch 吞异常的假成功', '~30 分钟', '回归测试要求功能语义成立，不允许空跑'),
    ('CJK JSON 编码反复失败', '~25 分钟', '夹具与被测进程统一 UTF-8；不再换解析器瞎试'),
    ('窗口清理竞态/首登录弹窗', '~20 分钟', '专用 --user-data-dir + 按 profile 精确杀进程'),
]
xs = [0.6, 3.2, 5.9]; ws = [2.5, 2.0, 6.8]
y = 1.8
for i, r in enumerate(rows):
    for c in range(3):
        tf = box(s, xs[c], y, ws[c], 0.5)
        setp(tf.paragraphs[0], r[c], 14 if i else 15, i == 0, ACCENT if i == 0 else (RED if c == 0 else INK), 0)
    y += 0.55
tf = box(s, 0.6, y + 0.3, 12.1, 1.2)
setp(tf.paragraphs[0], '净效果: 后半程同类障碍的排查速度从 ~25 分钟降到 ~5 分钟。', 17, True, GREEN)

# ---- S8 status ------------------------------------------------------------ 
s = slide()
title_bar(s, '当前状态与下一步', '代码已修复并验证；发布节奏视 CI 情况而定')
tf = box(s, 0.6, 1.7, 12.1, 3.2)
lines = [
    ('已落地', '崩溃修复 + 枚举修复 + 回归测试，全量 npm test 通过'),
    ('发布', '版本 0.1.10: 提交/推送/打 tag，CI 自动 publish'),
    ('未做', '正式 Windows 沙箱(CI)上跑 interactive 夹具 — CI 无桌面 Edge 实例，回归依赖本机'),
]
first = True
for k, v in lines:
    p = tf.paragraphs[0] if first else tf.add_paragraph(); first = False
    setp(p, k + ': ', 18, True, ACCENT, 2)
    p2 = tf.add_paragraph(); setp(p2, v, 16, False, INK, 10)
tf = box(s, 0.6, 5.2, 12.1, 1.6)
setp(tf.paragraphs[0], '下一步候选', 17, True)
p = tf.add_paragraph(); setp(p, '① 用 REA 逆向 Codex / ZCode 的 win 端文本采样，看它们如何避开这个 UIA 坑 ② 把"选中-读取"路径加进 5 大应用类的验收清单 ③ 给 helper 加崩溃自愈(检测到非零退出码自动降级重试)', 15, False, MUTED)

import os
os.makedirs(os.path.dirname(OUT), exist_ok=True)
prs.save(OUT)
print('SAVED', OUT, os.path.getsize(OUT), 'bytes', len(prs.slides.__iter__.__self__._sldIdLst), 'slides')
