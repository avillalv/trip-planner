from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import os
OUT=os.path.dirname(os.path.abspath(__file__))+"/"
NAVY="#15203a"; BURG="#8c1d40"; SHEET="#fafbfd"; SUNK="#e3e8ef"; RULE="#d3dae4"; PINK="#e8678c"; PAPER="#edf1f5"

def wordmark(text, font_path, size, tracking=0.0):
    f=TTFont(font_path); gs=f.getGlyphSet(); cmap=f.getBestCmap(); upm=f['head'].unitsPerEm
    s=size/upm; x=0; paths=[]
    hmtx=f['hmtx']
    for ch in text:
        g=cmap[ord(ch)]
        pen=SVGPathPen(gs)
        tp=TransformPen(pen,(s,0,0,-s,x,0))
        gs[g].draw(tp); paths.append(pen.getCommands())
        x+=hmtx[g][0]*s+tracking*size
    cap=f['OS/2'].sCapHeight*s
    return " ".join(paths), x-tracking*size, cap

def mark(bg=True, rounded=False, tile_color=None):
    # 1024 grid. Open passport with a W route folded across the spine.
    tile=""
    if bg:
        rx=' rx="228"' if rounded else ''
        tile=f'<rect width="1024" height="1024"{rx} fill="{tile_color or NAVY}"/>'
    return f'''{tile}
  <path d="M512 250 Q380 196 238 214 Q214 217 214 242 L214 800 Q214 826 240 822 Q382 800 512 846 Z" fill="{SUNK}"/>
  <path d="M512 250 Q644 196 786 214 Q810 217 810 242 L810 800 Q810 826 784 822 Q642 800 512 846 Z" fill="{SHEET}"/>
  <path d="M512 250 L512 846" stroke="{RULE}" stroke-width="8" stroke-linecap="round"/>
  <polyline points="318,370 415,690 512,440 609,690 706,370" fill="none" stroke="{BURG}" stroke-width="74" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="318" cy="370" r="50" fill="{SUNK}" stroke="{BURG}" stroke-width="26"/>
  <circle cx="706" cy="370" r="58" fill="{BURG}"/>'''

def write(name, w, h, body, title):
    open(OUT+name,"w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}">\n  <title>{title}</title>\n  {body}\n</svg>\n')

write("wayfold-app-icon.svg",1024,1024,mark(bg=True),"Wayfold app icon")
write("wayfold-mark.svg",1024,1024,mark(bg=True,rounded=True),"Wayfold")

fp=os.environ.get("ARCHIVO_600", "package/files/archivo-latin-600-normal.woff")  # from: npm pack @fontsource/archivo
d,wid,cap=wordmark("Wayfold",fp,300,-0.01)
def lockup(dark):
    ink = "#dde4ef" if dark else NAVY
    bgc = "#16213d" if dark else PAPER
    ms=0.42  # mark scaled to 430px
    msize=1024*ms
    pad=90; gap=64
    H=int(msize+2*pad)
    base=pad+msize/2+cap/2
    W=int(pad+msize+gap+wid+pad)
    m=mark(bg=True,rounded=True,tile_color=('#22304f' if dark else None))
    body=(f'<rect width="{W}" height="{H}" fill="{bgc}"/>\n  '
          f'<g transform="translate({pad} {pad}) scale({ms})">{m}</g>\n  '
          f'<path transform="translate({pad+msize+gap:.1f} {base:.1f})" fill="{ink}" d="{d}"/>')
    return W,H,body
W,H,b=lockup(False); write("wayfold-logo.svg",W,H,b,"Wayfold")
W,H,b=lockup(True); write("wayfold-logo-dark.svg",W,H,b,"Wayfold")
d2,wid2,cap2=wordmark("Wayfold",fp,200,-0.01)
write("wayfold-wordmark.svg",int(wid2+8),int(cap2*1.5),f'<path transform="translate(4 {cap2*1.15:.1f})" fill="{NAVY}" d="{d2}"/>',"Wayfold")
print("ok",wid,cap)
