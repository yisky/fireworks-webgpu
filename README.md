# WebGPU 烟花

用 three.js WebGPU / TSL 实现的烟花示例。可复用模块在 `src/fireworks`，演示入口在 `src/App.tsx`。

## 运行

需要 pnpm，以及支持 WebGPU 的浏览器（较新的 Chrome、Edge 等）。不支持时控制台会报 WebGPU 初始化失败。

```sh
pnpm install
pnpm dev
```

`pnpm build` 做类型检查并打包，`pnpm preview` 预览构建结果。

## 目录

- `src/fireworks/`：可复用烟花模块（几何、TSL 材质、时间轴）
- `src/App.tsx`：使用示例 / 演示场景
- `docs/fireworks-webgpu-perf.md`：性能与后处理掉帧说明（可选读）

## 操作

- 鼠标拖拽旋转，滚轮缩放。
- 右上角 three.js Inspector：可开关后处理、调整显示参数；演示面板里有 Restart all 等。