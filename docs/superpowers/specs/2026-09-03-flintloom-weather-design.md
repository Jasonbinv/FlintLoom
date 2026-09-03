# FlintLoom 天气工具设计

日期：2026-09-03  
状态：已复核  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：插件 `@flintloom/weather` + 工具 `get_weather`。后端只 Open-Meteo（地理编码 + 预报）。从出生就是插件：禁止 `createRuntime` 里直接 `register` 该工具。本片 **不做** 工具管理中心、市场、联网开关绑定。

## 1. 这是什么

可选能力插件：yml 挂上后，模型可调用 `get_weather`，按地点名查询 **当前天气 + 未来最多 7 天日报**（最高/最低温、天气现象、降水概率）。结果走现有 `tool/call` + `tool/result`，不新增 SSE。无 API Key。不跟 Composer「联网」开关绑定。

验收：`pnpm desktop` 打开含 `weather` 行的工作区，关联网发「北京今天天气」→ schema 有 `get_weather`，可调用；`tool/result` 含解析后的地名、当前气温、Daily 行、末行 `Source: Open-Meteo`。yml 去掉该行并重启 host → schema 无 `get_weather`，聊天仍可用。未解析到地点或 HTTP 失败 → `failed: ...`，不抛崩 loop。自动化测试注入假 `fetch`，不打真实 `open-meteo.com`。

## 2. 收紧的决策

| 点 | 决定 |
|---|---|
| 插件 | `@flintloom/weather`，yml id `weather`，依赖 `tools`，放在 `web-search` 之后、`knowledge` 之前。去掉该行 → 无工具，其它对话照常。 |
| 默认组装 | 根 `flintloom.yml` 与 host `ASSEMBLY` **写入**该行。 |
| 注册 | 插件在 yml 里就 **始终** `register(get_weather)`。不随 UI unregister。 |
| 联网开关 | **不绑**。`runTurn` **不**按 `webSearch` 过滤 `get_weather`。关联网仍可查天气。开联网时模型应优先本工具而不是 `web_search` 查天气（靠工具 description，不改 system 人格）。 |
| 后端 | 只 Open-Meteo 公共非商用端点。地理编码 `https://geocoding-api.open-meteo.com/v1/search`；预报 `https://api.open-meteo.com/v1/forecast`。无 Key，host **不**写 `runtimeConfigById["weather"]`。 |
| 参数 | 必填 `location`（去空白后长度 2–200）；可选 `days`（1–7，默认 7，非法则 7）。v1 **不**收 lat/lon。 |
| 地理编码 | `count=1`，取第一条。含 CJK（`/[\u3400-\u9fff]/`）→ `language=zh`，否则 `language=en`。模型可把地点写成 `City, Country` 消歧。 |
| 预报字段 | `timezone=auto`（daily **必须**带 timezone）。`current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`。`daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max`。显式 `temperature_unit=celsius`、`wind_speed_unit=kmh`。 |
| Guard | 与 `web_search` 一样 **不走** guard-ask：`TOOLS_PRE_EXECUTE` 对 `get_weather` 直接 `next()`。 |
| 超时 | 两次 HTTP **共用** 12s（`AbortSignal.any([exec.signal, AbortSignal.timeout(12_000)])`）。`User-Agent: FlintLoom/get_weather`。 |
| `fetch` | 工厂 `createGetWeatherTool({ fetch? })`，缺省 `globalThis.fetch`。测试只注入假 fetch。 |
| 归属 | 成功结果末行 `Source: Open-Meteo`（CC-BY 4.0）。 |
| 桌面 | `toolDisplayTitle("get_weather")` = `Weather`。`toolDisplaySummary` 对 `location` 字符串原样返回（与 `query` 同级）。不改 Composer、不改 `/v1/turns`。 |
| host | `apps/host/src` **不得**出现 `@flintloom/weather`（连 `import type` 也不要）。根 `package.json` `devDependencies` 列入该包，供 `import(name)` 解析。 |
| 管理中心 / 市场 | **本片不做**。以后按 yml 行开关，不在本片预留 API。 |
| 商用端点 | v1 不用 customer URL / apikey。以后若要商用再加配置。 |

## 3. 非目标

- 逐小时、空气质量、雷达、历史气候、华氏单位参数
- 桌面开关、yml 以外的热插拔、工具管理中心、市场后台
- 国内访问 Open-Meteo 的代理或镜像
- 改 loop system 人格；不追加天气专用 hint
- `.env` / `runtimeConfigById` 天气项
- 多候选城市列表（只取地理编码第一条，正文写清解析结果）

## 4. 架构

```text
模型调用 get_weather({ location, days? })
        │
        ▼
  @flintloom/weather
        │
        ├─ 1. GET geocoding-api.open-meteo.com/v1/search
        │     name=location  count=1  language=zh|en
        │
        └─ 2. GET api.open-meteo.com/v1/forecast
              latitude longitude timezone=auto
              current + daily  forecast_days=days
                    │
                    ▼
              格式化纯文本 tool/result
              末行 Source: Open-Meteo
```

yml：

```yaml
  - id: weather
    name: "@flintloom/weather"
```

```text
packages/weather/package.json          # name @flintloom/weather，依赖 kernel + tools
packages/weather/src/types.ts
packages/weather/src/geocode.ts        # 城市名 → 第一条命中
packages/weather/src/forecast.ts       # 经纬度 → current + daily
packages/weather/src/wmo.ts            # weather_code → 短英文；未知 WMO {n}
packages/weather/src/format.ts         # 结构化结果 → 纯文本
packages/weather/src/tool.ts           # createGetWeatherTool
packages/weather/src/index.ts          # default plugin
```

`pnpm-workspace` 的 `packages/*` 已覆盖新目录。根 `tsconfig.json` / `vitest.config.ts` 的 `packages/*/src`、`packages/**/tests` 已覆盖，不必改 glob。

插件 `apply`：`ctx.require<ToolRegistry>("tools")`，`ctx.effect(tools.register(createGetWeatherTool()))`。yml `config` 忽略（v1 无配置项）。

## 5. 组件

### 5.1 工具契约

```text
name: get_weather
description: Get current weather and a daily forecast for a named place. Prefer this over web_search for temperature, conditions, wind, humidity, or rain chance. Not for historical climate.
parameters:
  type: object
  required: ["location"]
  properties:
    location: { type: "string", minLength: 2, maxLength: 200 }
    days: { type: "integer", minimum: 1, maximum: 7 }
```

`location` 去首尾空白后长度少于 2 → `failed: empty location`（Open-Meteo 对空串和单字符搜索不返回结果，不要再发请求）。`days` 缺省或非法 → 7。

### 5.2 地理编码

`GET https://geocoding-api.open-meteo.com/v1/search?name=&count=1&language=`

成功取 `results[0]`：`name`、`latitude`、`longitude` 必有，否则 `failed: weather`。`country`、`admin1`、`timezone` 可选。

无 `results` 或空数组 → `failed: location not found`。HTTP 4xx/5xx → `failed: weather <status>`。超时 → `failed: timeout`。`signal.aborted` 且非超时 → `aborted`。

### 5.3 预报

`GET https://api.open-meteo.com/v1/forecast` 查询参数：

- `latitude` `longitude` 来自地理编码
- `current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`
- `daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max`
- `timezone=auto`
- `forecast_days=` 已规范化的 days
- `temperature_unit=celsius`
- `wind_speed_unit=kmh`

缺 `current`、或缺 `daily.time` 与气温数组等长对齐 → `failed: weather`。HTTP 错误同地理编码前缀 `failed: weather <status>`。

`current` 为对象；`daily` 为平行数组。只输出前 `days` 天（与 `forecast_days` 一致，后端已截断则用实际长度）。

### 5.4 WMO 映射

对 Open-Meteo 文档表逐码映射；未列出的整数 → `WMO {n}`，**不**抛错、**不**当成 `failed:`。

| code | 文本 |
|---|---|
| 0 | Clear sky |
| 1 | Mainly clear |
| 2 | Partly cloudy |
| 3 | Overcast |
| 45 | Fog |
| 48 | Depositing rime fog |
| 51 | Light drizzle |
| 53 | Moderate drizzle |
| 55 | Dense drizzle |
| 56 | Light freezing drizzle |
| 57 | Dense freezing drizzle |
| 61 | Slight rain |
| 63 | Moderate rain |
| 65 | Heavy rain |
| 66 | Light freezing rain |
| 67 | Heavy freezing rain |
| 71 | Slight snow |
| 73 | Moderate snow |
| 75 | Heavy snow |
| 77 | Snow grains |
| 80 | Slight rain showers |
| 81 | Moderate rain showers |
| 82 | Violent rain showers |
| 85 | Slight snow showers |
| 86 | Heavy snow showers |
| 95 | Thunderstorm |
| 96 | Thunderstorm with slight hail |
| 99 | Thunderstorm with heavy hail |

### 5.5 成功文本

给模型的纯文本，不是 JSON 代码块。温度、风速四舍五入为整数；湿度为整数 `%`。经纬度保留两位小数。

Location 行：`name` 必有。`admin1` 存在且与 `name` 不同则插入；`country` 存在则追加。

```text
Location: Beijing, China (39.90, 116.41)
Timezone: Asia/Shanghai
Current (2026-09-03T15:00): 22°C, Partly cloudy, humidity 55%, wind 12 km/h
Daily:
2026-09-03  18/28°C  Partly cloudy  rain 20%
2026-09-04  17/26°C  Slight rain  rain 60%
Source: Open-Meteo
```

- `Timezone:` 仅当地理编码或预报提供 timezone 时输出该行。
- `Current (` 后的时间为 `current.time`；缺失则省略括号时间，写成 `Current: 22°C, ...`。
- Daily 每行 `yyyy-mm-dd  {min}/{max}°C  {desc}`；`precipitation_probability_max` 为数字时追加 `  rain {n}%`，缺失则不加 rain 子句。
- 总结果超过 8_000 字则截断（与 `web_search` 相同上限）。

### 5.6 Guard

`packages/tools/src/plugin.ts`：`p.guardBypass === true || p.tool === "web_search" || p.tool === "get_weather"` 则 `next()`。其它工具行为不变。

### 5.7 桌面展示

`toolDisplayTitle` 增加 `get_weather: "Weather"`。  
`toolDisplaySummary`：args 对象上 `typeof location === "string"` 时返回该字符串（去空白后原样；空则继续后续规则）。不要把整段 JSON 当 summary。

## 6. 数据流

1. 工作区 yml 含 `weather` 行，host `createRuntime` 动态 `import("@flintloom/weather")`。
2. 用户发「北京今天天气」（联网开或关均可）。
3. 该轮 schema 含 `get_weather`；模型可调用 0 次或多次（仍受 `MAX_STEPS`）。
4. 工具 geocode → forecast → 格式化文本写入 `tool/result`。
5. 去掉 yml 行并重启 → schema 无该工具；已加载 runtime **不**热卸载（本片不改 reload；与现网其它插件相同，改 yml 需重启 host）。

CLI / 飞书等通道：只要该工作区 yml 挂了插件，同样可见 `get_weather`（与 `fs` 相同，不另做通道开关）。

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| yml 未挂 weather | schema 无 `get_weather` |
| location 去空白后少于 2 字 | `failed: empty location`，不发 HTTP |
| 地理编码零命中 | `failed: location not found` |
| HTTP 4xx/5xx | `failed: weather <status>` |
| JSON 缺必要字段 / 数组错位 | `failed: weather` |
| 超时 | `failed: timeout` |
| 调用方 abort | `aborted` |
| 未知 WMO | 正文里 `WMO {n}`，仍算成功 |

失败字符串与现有工具一致：以 `failed:` 开头或恰好 `aborted`，桌面 `toolResultState` 已能标红。不把异常抛出 loop。

密钥：本工具无密钥。不得把完整请求 URL 以外的内部配置写入 `tool/result`（本片无配置）。

## 8. 测试

禁止真实网络。假 `fetch` 按 URL host/path 分支返回夹具。

| 文件 | 断言 |
|---|---|
| `packages/weather/tests/geocode.test.ts` | `北京` 请求含 `language=zh`；`Beijing` 含 `language=en`；无/空 `results` → 未找到；HTTP 403 → `failed: weather 403` |
| `packages/weather/tests/forecast.test.ts` | 假 JSON 映射 current + daily；缺 `current` → `failed: weather` |
| `packages/weather/tests/wmo.test.ts` | `2` → `Partly cloudy`；`999` → `WMO 999` |
| `packages/weather/tests/format.test.ts` | 固定夹具含 Location / Current / Daily / Source；admin1 与 name 相同时不重复；缺 rain 数字则无 `rain` 子句 |
| `packages/weather/tests/tool.test.ts` | `" "`、`"a"` → `failed: empty location`；`days: 99` 当 7；成功串起两跳；超时 / abort |
| `packages/weather/tests/plugin.test.ts` | apply 后 schema 含 `get_weather` |
| `packages/tools/tests/guard-ask.test.ts` | `get_weather` 不进 gate（对标现有 `web_search` 用例） |
| `apps/host/tests/server.test.ts` | host `src` 不含 `@flintloom/weather`；默认 ASSEMBLY schema **含** `get_weather`；`ASSEMBLY.replace` 掉 weather 行后不含 |
| `apps/desktop/tests/toolDisplay.test.ts` | 标题 `Weather`；`{ location: "北京" }` summary 为 `北京` |

组装（测试会间接覆盖）：

- 根 `flintloom.yml`、`apps/host/tests/assembly.ts`：在 `web-search` 后插入 weather 行
- 根 `package.json` `devDependencies`：`@flintloom/weather`
- 现有「默认 ASSEMBLY 含 `web_search`」那条断言 **同时** `toContain("get_weather")`

不测：真实 Open-Meteo、逐小时、空气质量、联网开关与天气的交叉（仅保证过滤逻辑仍只针对 `web_search`）、工具管理 UI。国内打不开 `open-meteo.com` 属运行环境，v1 不做代理，不写失败测试。

## 9. 手工验收

1. 根 yml 含 weather，`pnpm desktop`，关联网，问北京天气 → 工具行标题 Weather，OUT 有温度与 Source。
2. 开联网再问一次 → 仍应走 `get_weather`（允许模型偶发 `web_search`，不作为自动化断言）。
3. 删 yml 行、重启 host → 再问天气，无 `get_weather` 工具行。
4. `pnpm test` 与 `pnpm typecheck` 绿。
