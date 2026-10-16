import math,sys
from shapely.geometry import LineString, Point
from shapely.ops import unary_union
from shapely.geometry.polygon import orient
from shapely import affinity
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
S=int(sys.argv[1]);OUT=sys.argv[2]; h=S/2; H=700; Y0=h; Y1=H-h; YM=350; N=2.5; SB=38
def sp(c,n=N):
    return math.copysign(abs(c)**(2/n),c)
def ell(cx,cy,rx,ry,a0,a1,k=28):
    pts=[]
    for i in range(k+1):
        a=math.radians(a0+(a1-a0)*i/k); pts.append((cx+rx*sp(math.cos(a)),cy+ry*sp(math.sin(a))))
    return pts
def rot(pts,W): return [(W-x,H-y) for x,y in pts]
G={}
def add(ch,W,strokes,dots=(),flip=None):
    G[ch]=(W,strokes,dots)
def box(W): return h,W-h
W=600
# letters
x0,x1=box(560);cx=280
def A():
    W=640;x0,x1=box(W);cx=W/2;by=240;f=lambda y:(cx-x0)*(y-Y0)/(Y1-Y0)
    return W,[[(x0,Y0),(cx,Y1),(x1,Y0)],[(x0+f(by),by),(x1-f(by),by)]]
G['A']=A()+((),)
def B():
    W=580;x0,x1=box(W);r1=165;r2=185
    return W,[[(x0,Y0),(x0,Y1),(x1-r1-10,Y1)]+ell(x1-r1-10,504,r1+10,154,90,-90)+[(x0,YM)],[(x0,YM),(x1-r2,YM)]+ell(x1-r2,196,r2,154,90,-90)+[(x0,Y0)]]
G['B']=B()+((),)
def C():
    W=620;x0,x1=box(W);cx=W/2
    return W,[ell(cx,YM,(x1-x0)/2,308,42,318,40)]
G['C']=C()+((),)
def D():
    W=620;x0,x1=box(W);xb=x1-250
    return W,[[(x0,Y0),(x0,Y1),(xb,Y1)]+ell(xb,YM,x1-xb,308,90,-90)+[(x0,Y0)]]
G['D']=D()+((),)
G['E']=(520,[[(480,Y1),(x0:=h,Y1),(h,Y0),(480,Y0)],[(h,YM),(430,YM)]],())
G['F']=(500,[[(460,Y1),(h,Y1),(h,Y0)],[(h,YM),(410,YM)]],())
def Gg():
    W=640;x0,x1=box(W);cx=W/2
    return W,[ell(cx,YM,(x1-x0)/2,308,40,360,44)+[(x1,YM),(cx+10,YM)]]
G['G']=Gg()+((),)
G['H']=(600,[[(h,Y0),(h,Y1)],[(600-h,Y0),(600-h,Y1)],[(h,YM),(600-h,YM)]],())
G['I']=(170,[[(85,Y0),(85,Y1)]],())
def J():
    W=360;x0,x1=box(W);r=(x1-x0)/2;cy=Y0+r
    return W,[[(x1,Y1),(x1,cy)]+ell((x0+x1)/2,cy,r,r,0,-180,20)+[(x0,cy+40)]]
G['J']=J()+((),)
G['K']=(580,[[(h,Y0),(h,Y1)],[(540,Y1),(h,330)],[(150,400),(540,Y0)]],())
G['L']=(480,[[(h,Y1),(h,Y0),(440,Y0)]],())
G['M']=(760,[[(h,Y0),(h,Y1),(380,300),(760-h,Y1),(760-h,Y0)]],())
G['N']=(620,[[(h,Y0),(h,Y1),(620-h,Y0),(620-h,Y1)]],())
def O():
    W=660;x0,x1=box(W);return W,[ell(W/2,YM,(x1-x0)/2,308,0,360,60)]
G['O']=O()+((),)
def Pp(W=560,k=1):
    x0,x1=box(W);r=170;cy=Y1-(Y1-300)/2
    return W,[[(x0,Y0),(x0,Y1),(x1-r,Y1)]+ell(x1-r,cy,r,(Y1-300)/2,90,-90)+[(x0,300)]]
G['P']=Pp()+((),)
def Q():
    W,s=O();return W,s+[[(W/2+30,170),(W-h+14,Y0-2)]]
G['Q']=Q()+((),)
def R():
    W,s=Pp(580);return W,s+[[(230,300),(580-h,Y0)]]
G['R']=R()+((),)
def Ss():
    W=560;x0,x1=box(W);cx=W/2;rx=(x1-x0)/2
    return W,[ell(cx,504,rx,154,28,270,36)+[(cx,350)]+ell(cx,196,rx,154,90,-152,36)]
G['S']=Ss()+((),)
G['T']=(580,[[(h,Y1),(580-h,Y1)],[(290,Y1),(290,Y0)]],())
def U():
    W=600;x0,x1=box(W);r=(x1-x0)/2;cy=Y0+r
    return W,[[(x0,Y1),(x0,cy)]+ell(W/2,cy,r,r,180,360,24)+[(x1,Y1)]]
G['U']=U()+((),)
G['V']=(640,[[(h,Y1),(320,Y0),(640-h,Y1)]],())
G['W']=(900,[[(h,Y1),(255,Y0),(450,520),(645,Y0),(900-h,Y1)]],())
G['X']=(620,[[(h,Y1),(620-h,Y0)],[(h,Y0),(620-h,Y1)]],())
G['Y']=(620,[[(h,Y1),(310,YM),(620-h,Y1)],[(310,YM),(310,Y0)]],())
G['Z']=(560,[[(h,Y1),(560-h,Y1),(h,Y0),(560-h,Y0)]],())
# digits
def zero():
    W=600;x0,x1=box(W);return W,[ell(W/2,YM,(x1-x0)/2,308,0,360,60)]
G['0']=zero()+((),)
G['1']=(380,[[(60,520),(250,Y1),(250,Y0)]],())
def two():
    W=560;x0,x1=box(W);cx=W/2;rx=(x1-x0)/2
    return W,[ell(cx,490,rx,168,165,-25,30)+[(h,Y0),(x1,Y0)]]
G['2']=two()+((),)
def three():
    W=560;x0,x1=box(W);cx=W/2
    return W,[ell(cx,504,(x1-x0)/2,154,150,-90,28)+[(cx-30,YM)],[(cx-30,YM)]+ell(cx,196,(x1-x0)/2,154,90,-150,28)]
G['3']=three()+((),)
G['4']=(600,[[(430,Y0),(430,Y1),(h,230),(600-h,230)]],())
def five():
    W=560;x0,x1=box(W);cx=W/2;rx=(x1-x0)/2
    return W,[[(x1,Y1),(x0+20,Y1),(x0+14,372)]+ell(cx,222,rx,180,118,-152,34)]
G['5']=five()+((),)
def six():
    W=600;x0,x1=box(W);cx=W/2;rx=(x1-x0)/2
    return W,[ell(cx,236,rx,194,0,360,50),[(x0,236),(x0,400)]+ell(cx,410,rx,Y1-410,180,58,26)]
G['6']=six()+((),)
def nine():
    W,s=six();return W,[rot(p,W) for p in s]
G['9']=nine()+((),)
def eight():
    W=580;x0,x1=box(W);cx=W/2
    return W,[ell(cx,516,(x1-x0)/2-14,142,0,360,44),ell(cx,194,(x1-x0)/2,152,0,360,44)]
G['8']=eight()+((),)
G['7']=(560,[[(h,Y1),(560-h,Y1),(180,Y0)]],())
# punctuation
G['.']=(190,[],[(95,92,50)])
G[',']=(190,[[(100,70),(70,-70)]],[(100,100,50)])
G['-']=(380,[[(h,300),(380-h,300)]],())
G[':']=(190,[],[(95,92,50),(95,470,50)])
G['!']=(190,[[(95,Y1),(95,250)]],[(95,92,50)])
def qm():
    W=500;x0,x1=box(W);cx=W/2
    return W,[ell(cx,490,(x1-x0)/2,168,160,-60,30)+[(cx,300),(cx,230)]]
G['?']=qm()+([(250,92,50)],)
G['+']=(480,[[(h,YM),(480-h,YM)],[(240,YM-200),(240,YM+200)]],())
G['/']=(420,[[(h,Y0),(420-h,Y1)]],())
G['%']=(780,[ [(h,Y0),(780-h,Y1)] ],[(170,520,100),(610,180,100)])
G["'"]=(170,[[(85,Y1),(85,480)]],())
G['(']=(280,[ell(300,YM,200,Y1-YM+60,100,260,20)],())
G[')']=(280,[ell(-20,YM,200,Y1-YM+60,80,-80,20)],())
G['&']=(620,[[(580,Y0),(150,430)]+ell(250,520,110,138,215,-40,24)[::-1][:0]],())
del G['&']
G['#']=(660,[[(230,Y0),(290,Y1)],[(370,Y0),(430,Y1)],[(h,230),(620,230)],[(h,470),(620,470)]],())
G['*']=(420,[[(210,380),(210,640)],[(100,440),(320,580)],[(320,440),(100,580)]],())
G['$']=(560,[ell(280,504,238,154,28,270,36)+[(280,350)]+ell(280,196,238,154,90,-152,36),[(280,Y1+30),(280,Y0-30)]],())
G['@']=(780,[ell(390,YM,340,308,0,360,60)],())
del G['@']
def glyph_poly(ch):
    W,strokes,dots=G[ch]; shapes=[]
    for s in strokes:
        if len(s)>=2: shapes.append(LineString(s).buffer(h,cap_style=2,join_style=1,resolution=10))
    for (x,y,r) in dots: shapes.append(Point(x,y).buffer(r*(h/42) if r<=50 else r,resolution=14))
    return W,(unary_union(shapes) if shapes else None)
names=[".notdef","space"];cmap={32:"space"};adv={".notdef":600,"space":260};gl={}
pen=TTGlyphPen(None);pen.moveTo((60,0));pen.lineTo((60,700));pen.lineTo((540,700));pen.lineTo((540,0));pen.closePath()
pen.moveTo((120,60));pen.lineTo((480,60));pen.lineTo((480,640));pen.lineTo((120,640));pen.closePath();gl[".notdef"]=pen.glyph()
pen=TTGlyphPen(None);gl["space"]=pen.glyph()
def draw(poly,sx):
    pen=TTGlyphPen(None)
    polys=[poly] if poly.geom_type=="Polygon" else list(poly.geoms)
    for p in polys:
        p=orient(p.simplify(.8),sign=-1.0)
        for ring in [p.exterior]+list(p.interiors):
            c=[(round(x+sx),round(y)) for x,y in ring.coords[:-1]]
            pen.moveTo(c[0]); [pen.lineTo(q) for q in c[1:]]; pen.closePath()
    return pen.glyph()
for ch in list(G):
    W,poly=glyph_poly(ch)
    if poly is None: continue
    nm={".":"period",",":"comma","-":"hyphen",":":"colon","!":"exclam","?":"question","+":"plus","/":"slash","%":"percent","'":"quotesingle","(":"parenleft",")":"parenright","#":"numbersign","*":"asterisk","$":"dollar"}.get(ch,ch if ch.isdigit()==False else {"0":"zero","1":"one","2":"two","3":"three","4":"four","5":"five","6":"six","7":"seven","8":"eight","9":"nine"}[ch])
    names.append(nm);gl[nm]=draw(poly,SB);adv[nm]=int(W+2*SB);cmap[ord(ch)]=nm
    if ch.isalpha(): cmap[ord(ch.lower())]=nm
fb=FontBuilder(1000,isTTF=True);fb.setupGlyphOrder(names);fb.setupCharacterMap(cmap);fb.setupGlyf(gl)
fb.setupHorizontalMetrics({n:(adv[n],0) for n in names});fb.setupHorizontalHeader(ascent=820,descent=-220)
fb.setupNameTable({"familyName":"Ascentra Display","styleName":OUT,"uniqueFontIdentifier":"AscentraDisplay-Regular","fullName":"Ascentra Display Regular","psName":"AscentraDisplay-Regular","copyright":"Original design for ASCENTRA Founders Academy"})
fb.setupOS2(sTypoAscender=820,sTypoDescender=-220,usWinAscent=900,usWinDescent=260,sCapHeight=700,sxHeight=700);fb.setupPost()
fb.font.save(OUT+".ttf");fb.font.flavor="woff2";fb.font.save(OUT+".woff2")
print(len(names),"glyphs")
