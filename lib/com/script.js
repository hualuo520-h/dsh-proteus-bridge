/**
 * COM 传输的 PowerShell 端（仅 Labcenter COM SDK 环境可用；shipping Proteus 8 ≤8.17
 * 无此服务器）。op 名与 src/com/protocol.ts OPS 一一对应；标注 TODO(verify) 的成员名
 * 交付前用 introspect op 对照真实类型库锁定。
 */
export const COM_BROKER_PS1 = String.raw `
param()
$ErrorActionPreference = 'Stop'
$script:app = $null       # IApplication —— 全程唯一，禁止二次 New-Object
$script:project = $null   # IProject

function Fail([string]$m) { throw $m }

function Ensure-App {
  if ($null -eq $script:app) {
    try {
      $script:app = New-Object -ComObject Labcenter.InteractiveSimulation
    } catch {
      Fail "PROTEUS_NOT_INSTALLED: cannot create Labcenter.InteractiveSimulation ($($_.Exception.Message))"
    }
  }
  return $script:app
}

# ---- ops（TODO(verify)：成员名对照真实类型库后锁定）----
function Op_ping($a) { @{ pong = $true } }

function Op_detectVersion($a) {
  $app = Ensure-App
  @{ major = 8; build = [string]$app.Version }   # TODO(verify)
}

function Op_openProject($a) {
  $app = Ensure-App
  if (-not $a.path) { Fail 'path is required' }
  $script:project = $app.OpenProject($a.path)    # TODO(verify)
  @{ opened = $true }
}

function Op_projectInfo($a) {
  if ($null -eq $script:project) { Fail 'PROJECT_NOT_OPEN' }
  # TODO(verify): SchematicSheets 枚举与 Components 计数
  $sheets = @()
  foreach ($s in $script:project.SchematicSheets) {
    $sheets += @{ name = [string]$s.Name; componentCount = @($s.Components).Count }
  }
  @{ sheets = $sheets }
}

function Op_placeComponent($a) {
  if ($null -eq $script:project) { Fail 'PROJECT_NOT_OPEN' }
  # TODO(verify): 放置 API；坐标为模板原点（100000 = 1mm，Y 向上）
  $sheet = $script:project.ActiveSheet
  $sheet.Components.Place($a.device, $a.ref, [int]$a.x, [int]$a.y, [int]$a.rotationDeg)
  @{ ref = [string]$a.ref }
}

function Op_componentPins($a) {
  if ($null -eq $script:project) { Fail 'PROJECT_NOT_OPEN' }
  # TODO(verify): pins(ref) —— 引脚世界坐标与出线方向
  $pins = @()
  foreach ($p in $script:project.ActiveSheet.pins($a.ref)) {
    $pins += @{ index = [string]$p.Index; name = [string]$p.Name; x = [int]$p.X; y = [int]$p.Y; directionDeg = [int]$p.Direction }
  }
  @{ pins = $pins }
}

function Op_connectPins($a) {
  if ($null -eq $script:project) { Fail 'PROJECT_NOT_OPEN' }
  $r = $script:project.ActiveSheet.connect("$($a.aRef).$($a.aPin)", "$($a.bRef).$($a.bPin)")   # TODO(verify)
  @{ junctions = $r }
}

function Op_unknownObjectReport($a) {
  if ($null -eq $script:project) { Fail 'PROJECT_NOT_OPEN' }
  # TODO(verify): 未知对象枚举；空数组 = 可以安全重写
  @{ kinds = @() }
}

function Op_saveProjectAs($a) {
  if ($null -eq $script:project) { Fail 'PROJECT_NOT_OPEN' }
  $script:project.SaveAs($a.path)   # TODO(verify)
  @{ saved = $true }
}

function Op_schematicEditProbe($a) {
  # Proteus 9 专用：打开临时最小工程做一次无副作用原理图读
  # TODO(verify): 9 的探测流程；失败时返回 supported=false + reason
  @{ supported = $false; reason = 'probe not implemented for this build' }
}

function Op_simStart($a)   { $app = Ensure-App; $app.Simulation.Start()  | Out-Null; @{ state = 'running' } }  # TODO(verify)
function Op_simPause($a)   { $app = Ensure-App; $app.Simulation.Pause()  | Out-Null; @{ state = 'paused'  } }  # TODO(verify)
function Op_simResume($a)  { $app = Ensure-App; $app.Simulation.Resume() | Out-Null; @{ state = 'running' } }  # TODO(verify)
function Op_simStop($a)    { $app = Ensure-App; $app.Simulation.Stop()   | Out-Null; @{ state = 'idle'    } }  # TODO(verify)

function Op_simStatus($a) {
  $app = Ensure-App
  # TODO(verify): 状态枚举映射 idle/running/paused/halted/error + timeSeconds + reason
  @{ state = 'idle' }
}

function Op_readProbes($a) {
  $app = Ensure-App
  # TODO(verify): 探针读取 API
  @{ probes = @() }
}

function Op_introspect($a) {
  $t = switch ($a.target) {
    'app'     { Ensure-App }
    'project' { $script:project }
    'sheet'   { if ($script:project) { $script:project.ActiveSheet } }
    default   { Fail 'target must be app|project|sheet' }
  }
  if ($null -eq $t) { Fail 'target object not available (not connected/open?)' }
  @{ members = @($t | Get-Member | ForEach-Object { $_.Name }) }
}

function Op_quit($a) {
  foreach ($o in @($script:project, $script:app)) {
    if ($null -ne $o) {
      try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($o) } catch {}
    }
  }
  $script:project = $null; $script:app = $null
  @{ bye = $true }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  $req = $line | ConvertFrom-Json
  if ($req.exit) { break }
  $results = @()
  foreach ($call in $req.calls) {
    try {
      $fn = Get-Item "function:Op_$($call.op)" -ErrorAction Stop
      $results += @{ ok = $true; value = & $fn.ScriptBlock $call.args }
    } catch {
      $results += @{ ok = $false; error = $_.Exception.Message }
    }
  }
  [Console]::Out.WriteLine((@{ id = $req.id; results = $results } | ConvertTo-Json -Depth 12 -Compress))
}
`;
