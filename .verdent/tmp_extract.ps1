$c = Get-Content "$env:TEMP\zip_ctrl_v1\shiftcontrol-app.html" -Raw
$i = $c.IndexOf('<script>')
$j = $c.IndexOf('</script>', $i)
$js = $c.Substring($i + 8, $j - $i - 8)
# Qutar comentarios decorativos para compactar
$js = $js -replace '/\*[\s\S]*?\*/', ''
$js = $js -replace '(?m)^\s*//.*$', ''
Out-File -FilePath "$env:TEMP\zip_ctrl_v1\app_engine.js" -InputObject $js -Encoding UTF8
Write-Output ("Extraido: " + $js.Length + " chars")
# Listar los bloques de datos seed
$seedIdx = $js.IndexOf('const ')
Write-Output ("Primer const en char " + $seedIdx)
