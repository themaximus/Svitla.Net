# Draws the app icon (lightning bolt on the widget's dark green) and saves it as a PNG-based .ico
param([Parameter(Mandatory)][string]$Out)

Add-Type -AssemblyName System.Drawing

function New-Png([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $s = $size / 256

  $bg = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = 56 * $s; $w = $size - 1
  $bg.AddArc(0, 0, $r, $r, 180, 90); $bg.AddArc($w - $r, 0, $r, $r, 270, 90)
  $bg.AddArc($w - $r, $w - $r, $r, $r, 0, 90); $bg.AddArc(0, $w - $r, $r, $r, 90, 90)
  $bg.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(13, 31, 24))), $bg)
  $g.DrawPath((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(0, 255, 136)), (8 * $s)), $bg)

  $bolt = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF (150 * $s), (28 * $s)),
    (New-Object System.Drawing.PointF (64 * $s), (146 * $s)),
    (New-Object System.Drawing.PointF (122 * $s), (146 * $s)),
    (New-Object System.Drawing.PointF (100 * $s), (228 * $s)),
    (New-Object System.Drawing.PointF (192 * $s), (104 * $s)),
    (New-Object System.Drawing.PointF (134 * $s), (104 * $s))
  )
  $g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0, 255, 136))), $bolt)
  $g.Dispose()

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  , $ms.ToArray()
}

$sizes = 16, 32, 48, 256
$images = $sizes | ForEach-Object { , (New-Png $_) }

$ico = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ico
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
  $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32)
  $bw.Write([uint32]$images[$i].Length); $bw.Write([uint32]$offset)
  $offset += $images[$i].Length
}
foreach ($img in $images) { $bw.Write($img) }
$bw.Flush()
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
[System.IO.File]::WriteAllBytes($Out, $ico.ToArray())
