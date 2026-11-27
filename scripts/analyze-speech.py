"""発話強度の再生成。開発用のPython依存: soundfile, numpy。
ピーク比-20dB未満の小さな余韻を除き、40ms単位の強度を保存する。"""
import os,json
from pathlib import Path
import soundfile as sf,numpy as np
os.chdir(Path(__file__).resolve().parent.parent)
out={}
for number in range(1,13):
 x,r=sf.read(f'public/sounds/narration/{number:02}.ogg',always_2d=True)
 hop=int(r*.04); rms=np.array([np.sqrt(np.mean(x[i:i+hop]**2)) for i in range(0,len(x),hop)])
 peak=max(rms); gate=peak*.1
 levels=[round(float(np.sqrt(max(0,v-gate)/max(peak-gate,1e-9)))*100) for v in rms]
 out[str(number)]={'durationMs':len(x)/r*1000,'levels':levels}
 print(number,'duration',round(len(x)/r,2),'last voiced',round((max(i for i,v in enumerate(levels) if v)+1)*.04,2))
Path('src/data/speech-envelope.json').write_text(json.dumps(out,separators=(',',':'))+'\n')
