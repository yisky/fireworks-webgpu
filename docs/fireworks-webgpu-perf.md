# fireworks-webgpu 性能分析

日期: 2026-10-10  
结论先说: **120 ↔ 75 FPS 的摆动对当前栈来说并不异常**，更像是「空闲/升空阶段」与「多发同时爆炸 + 后处理满开」之间的正常负载差，而不是明显的逻辑 bug。

## 当前负载画像

| 项 | 现状 |
|---|---|
| 实例 | **18** 发，各自 `new Fireworks` + **独立几何**（detail=0 去重后约 12 条爆炸飘带 + 1 条升空） |
| 材质 | `MeshBasicNodeMaterial`，**AdditiveBlending**，`depthWrite=false`，片元噪声溶解 + tip bloom |
| 分辨率 | `setPixelRatio(min(devicePixelRatio, 2))` → 高分屏常为 **DPR=2**（像素量 ×4） |
| MSAA | `antialias: true`（与全屏后处理叠在一起仍吃带宽） |
| 后处理 | scene pass → Bloom → vignette → exposure → **FXAA** → chromatic → film → ACES |
| 已弃用 | TRAA（自定义 `positionNode` 写不好 velocity） |
| 调试 | **Inspector** 常开（Profiler/Memory 图也会占一点 CPU/GPU） |

相机较远、爆炸高度 14–28、`burstScale` 2.6–4.6 → 爆发时屏幕上 additive 覆盖面积大。

## 为何会 120 ↔ 75（而不是「坏了」）

1. **垂直同步 / 显示器刷新**  
   很多笔记本在轻负载时锁在 **120Hz**（或接近），重负载掉到无法维持时就变成 **~75** 附近（也可能是 60 的抖动/瞬时值）。「顶在 120、谷在 75」本身很像 **vsync 上限 + 偶发掉档**，不一定是 120→75 的线性算力崩坏。

2. **爆发相位的 fill-rate / overdraw（主因候选）**  
   - 升空阶段：每发主要是 **1 条** 升空飘带，便宜。  
   - 爆炸阶段：每发约 **12 条** additive 飘带，18 发若有一半重叠在 burst 窗内 → 上百条半透明条带叠画。  
   - `startTime` 约 0.1–4.9s，`burstDuration` 1.8–2.9s → **中段会有多发同时炸开**，fill-rate 与 bloom 提取面积一起冲高。  
   - Additive + `depthWrite=false`：**不 occlusion**，重叠像素反复加，正好打满带宽。

3. **Bloom 成本随「亮面积」涨**  
   Unreal 风格 bloom：亮区多时 downsample/blur/composite 更重。爆炸 tip bloom（材质内）再加后处理 bloom，爆发帧更容易掉速。

4. **全分辨率后处理链偏长**  
   FXAA、chromatic、film 都是 **全屏过一遍**（CA/FXAA 还多次采样）。在 DPR=2 下，每多一趟 ≈ 多画一张 2× 分辨率的全屏。

5. **Inspector**  
   开着 Performance/Memory 图时有额外开销；关 Inspector 或收起面板通常能抬几帧，但解释不了全部 45fps 落差。

6. **几何本身不重**  
   segments=5、detail=0、已方向去重 → **顶点成本不是主因**；瓶颈更像是 **像素填充 + 后处理**，不是 CPU 算 18 个 `update()`。

## 这套栈在笔记本 GPU 上怎样算「正常」

- 集成显卡 / 轻薄本：**60–120 波动**、爆发掉到 **50–80** 很常见。  
- 独显笔记本、DPR=1、后处理关一半：更容易 **稳在高刷新**。  
- 当前（18 发 additive + bloom + FXAA+CA+film + DPR≤2 + MSAA + Inspector）下，**峰值贴 120、谷值 ~75** 属于「可预期的相位相关掉帧」，不是必须立刻大改的异常。

若谷值长期 **&lt;50** 或静止升空也只有 75，再怀疑驱动/热降频/后台占满。

## 优化优先级（收益 / 成本）

1. **降 DPR**：`setPixelRatio(1)` 或 `Math.min(dpr, 1.5)` — 通常最大头，几乎无行。  
2. **Inspector 里关后处理做 A/B**：先关 **film + chromatic**，再关 **FXAA**，再关 **Bloom** — 验证是不是后处理主导。  
3. **减同时爆炸**：拉大 `startTime` 间距或略减 `burstDuration`，或壳数 **18→10–12**。  
4. **Bloom**：略增 threshold / 降 strength；长期可做 **半分辨率 bloom**（改动稍大）。  
5. **关 MSAA**（`antialias: false`）若已开 FXAA — 少一次多重采样成本。  
6. **共享几何**：18 份相同 icosahedron 飘带几何可共用一份 BufferGeometry — 省内存/上传，对 FPS 帮助通常 **小于** fill-rate 优化。  
7. **segments / detail**：已较低；再降对观感伤于收益。  
8. **材质 tip bloom**：爆发时已很亮，可略降 `bloomIntensity` 默认以减轻后处理 bloom 输入。

## 建议的快速自测

1. Inspector 关掉 Film + CA → 看谷值是否回升。  
2. `devicePixelRatio` 强制 1 刷一次。  
3. 临时 `SHOW_SHELLS.length` 砍一半。  
若 1/2 就明显贴回 120，即可认定是 **分辨率 × 全屏后处理 × 爆发填充**，而非烟花 TSL 逻辑错误。

本次未做代码大改（无单行明显 bug）。
