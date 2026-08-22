根据你本机情况：

| 项 | 数值 |
|---|---|
| GPU | **RTX 3070 Ti，8GB** |
| 当前空闲显存 | 约 **2.5GB**（桌面/Electron 等也在占 GPU） |
| 模型 | Qwen2.5-1.5B **Q4_K_M**，约 **1.07GB** |

1.5B + Q4 很小，**权重全放 GPU 没问题**；主要吃显存的是 **KV cache（由 `-c` 决定）**。

## 推荐参数

### 日常用 FlintLoom（推荐）

```powershell
.\llama-server.exe `
  -m "G:\llama\models\Qwen2.5-1.5B\qwen2.5-1.5b-instruct-q4_k_m.gguf" `
  --alias "qwen2.5-1.5b" `
  --host 127.0.0.1 `
  --port 8080 `
  -ngl 99 `
  -c 16384 `
  --chat-template qwen2 `
  -np 1
```

| 参数 | 建议 | 说明 |
|------|------|------|
| **`-ngl`** | **`99`** | 1.5B 层数不多，99 = 全层 GPU；权重约 1.1GB |
| **`-c`** | **`8192`** | 8GB 卡上较均衡；Agent 多轮 + 工具结果一般够用 |
| **`-np`** | **`1`** | 单用户（FlintLoom），少占显存 |

粗算显存（全 GPU、单路）：权重 ~1.1GB + KV（8192）~0.2–0.3GB + 开销 ~0.3–0.5GB → 合计约 **1.6–1.8GB**（仅 llama-server 时）。

### 若启动报 OOM / 显存不足

先关 Electron 或其它占 GPU 的程序，再试：

```powershell
-ngl 99 -c 4096 -np 1
```

仍 OOM 再降到 `-c 2048`。

### 若几乎只跑 llama（关掉占 GPU 的软件）

可试更长上下文：

```powershell
-ngl 99 -c 16384 -np 1
```

## 不建议

- **`-ngl` 不用省**：1.5B 全 GPU 才快；减层只会变慢，几乎省不了多少显存。
- **`-c` 别一上来 32768**：8GB 上容易 OOM，且 FlintLoom 单轮通常用不到。

## 可选（CUDA 包若支持）

```powershell
--flash-attn
```

可略减 KV 显存，有则加上；不支持会报错，去掉即可。

---

**结论**：你这块 3070 Ti 跑这个 1.5B Q4，**`-ngl 99` + `-c 8192` + `-np 1`** 是合适默认；桌面和 llama 同时开时若不稳，把 **`-c` 改为 `4096`**。改完 `.env` 指向 `http://127.0.0.1:8080/v1` 后记得重启 `pnpm desktop:app`。