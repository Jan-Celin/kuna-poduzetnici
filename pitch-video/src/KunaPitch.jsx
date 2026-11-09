import React from 'react';
import {AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import './style.css';
import './demo.css';

const scenes = [
  {start: 0, end: 330, index: '01', eyebrow: 'LOKALNI TRŽIŠNI KOMPAS', title: ['Otvoriti posao', 'ne bi smjelo početi', 'nagađanjem.'], copy: 'KUNA pretvara javne podatke u razgovor o lokaciji.', kind: 'opening'},
  {start: 330, end: 660, index: '02', eyebrow: 'PROBLEM', title: ['Podaci postoje.', 'Odluka je i dalje', 'teška.'], copy: 'Karta, demografija, pristup i konkurencija rijetko su na istome mjestu.', kind: 'problem'},
  {start: 660, end: 870, index: '03', kind: 'demo', shot: 'app-location.png', scale: 1.65, origin: '15% 44%', action: {from: [255, 610], to: [145, 535], click: 52}},
  {start: 870, end: 1020, index: '04', kind: 'demo', shot: 'app-market.png', scale: 1.85, origin: '23% 18%', action: {from: [555, 292], to: [451, 199], click: 48}},
  {start: 1020, end: 1230, index: '05', kind: 'demo', shot: 'app-market.png', scale: 1.45, origin: '55% 50%', action: {from: [1150, 708], to: [938, 548], click: 52}},
  {start: 1230, end: 1590, index: '06', kind: 'demo', shot: 'app-ai.png', background: 'app-location.png', modalCrop: {left: 670, top: 365, width: 488, height: 304}, scale: 1.45, origin: '50% 47%', action: {from: [920, 472], to: [1080, 594], click: 150}, ai: true},
  {start: 1590, end: 1800, index: '07', kind: 'demo', shot: 'app-plan.png', background: 'app-location.png', modalCrop: {left: 734, top: 370, width: 360, height: 298}, scale: 1.65, origin: '48% 49%', action: {from: [1135, 586], to: [1062, 503], click: 52}},
  {start: 1800, end: 2400, index: '09', eyebrow: 'KUNA', title: ['Javni podaci.', 'Jasnija odluka.', 'Bolji početak.'], copy: 'KUNA nije odgovor umjesto poduzetnika. Ona je bolja polazna točka.', kind: 'closing'}
];

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'};

const reveal = (frame, start, end) => ({
  opacity: interpolate(frame, [start, start + 14, end - 14, end], [0, 1, 1, 0], clamp),
  transform: `translateY(${interpolate(frame, [start, start + 18], [28, 0], clamp)}px)`
});

const Mark = () => <div className="mark"><span className="mark-tail"/><span className="mark-body"/><span className="mark-eye"/></div>;

const Ambient = () => {
  const frame = useCurrentFrame();
  return <>
    <div className="grain"/>
    <div className="grid"/>
    <div className="orb orb-one" style={{transform:`translate(${Math.sin(frame / 90) * 24}px, ${Math.cos(frame / 110) * 19}px)`}}/>
    <div className="orb orb-two" style={{transform:`translate(${Math.cos(frame / 80) * 20}px, ${Math.sin(frame / 100) * 22}px)`}}/>
  </>;
};

const MiniMap = ({mode}) => {
  const frame = useCurrentFrame();
  const dash = 520 + (frame % 90) * 4;
  return <div className={`mini-map ${mode}`}>
    <svg viewBox="0 0 700 540" aria-label="Stilizirana karta s poslovnim signalima">
      <path className="coast" d="M106 96 C155 45 232 76 273 135 C302 177 341 196 389 179 C431 164 487 133 551 153 C610 171 621 234 584 275 C553 310 522 329 527 374 C530 407 484 438 432 421 C389 408 356 437 300 429 C241 420 194 388 159 339 C123 288 65 270 82 206 C92 169 83 132 106 96 Z"/>
      <path className="road road-main" d="M107 266 C198 205 274 282 349 233 S493 162 584 218"/>
      <path className="road road-sub" d="M164 117 C189 185 235 246 299 347 S441 390 535 344"/>
      <path className="road road-sub" d="M138 314 C215 340 274 323 356 275 S458 276 548 295"/>
      <path className="reach-line" strokeDasharray="11 13" strokeDashoffset={dash} d="M149 285 C246 203 365 197 514 231"/>
      <circle className="reach" cx="354" cy="264" r="148"/>
      {[[215,231,'#d96c4e'],[290,316,'#643f82'],[407,226,'#216f78'],[476,299,'#b16e20'],[338,180,'#d96c4e'],[286,246,'#643f82'],[415,347,'#216f78']].map(([cx,cy,color],index)=><g key={index} className="pin" style={{transformOrigin:`${cx}px ${cy}px`,transform:`scale(${1 + Math.sin((frame + index * 12) / 20) * .06})`}}><circle cx={cx} cy={cy} r="13" fill={color}/><circle cx={cx} cy={cy} r="5" fill="#f7f4ed"/></g>)}
      <circle className="origin" cx="354" cy="264" r="11"/>
    </svg>
    <div className="map-label label-access">15 min po cestama</div>
    <div className="map-label label-market">tržišni ritam</div>
  </div>;
};

const Numbers = () => <div className="numbers"><div><b>70.829</b><span>stanovnika</span></div><div><b>4,2×</b><span>sezonski kontekst</span></div><div><b>69</b><span>živi OSM signali</span></div></div>;

const DataRail = () => <div className="data-rail"><span>DZS</span><i/><span>OSM API</span><i/><span>PROSTORNI SIGNALI</span><i/><span>ODLUKA</span></div>;

const AiPanel = () => <div className="ai-panel"><div className="ai-top"><span>●</span><b>KUNA AI</b><em>lokalno</em></div><p>Gdje se vidi prostor za razlikovanje?</p><div className="ai-answer"><i>↗</i><span>Pristup i aktivnost su vidljivi; ponuda traži jasan fokus.</span></div></div>;

const Flow = () => <div className="flow"><div><b>01</b><span>Lokacija</span></div><i>→</i><div><b>02</b><span>Zaključak</span></div><i>→</i><div><b>03</b><span>Plan</span></div><i>→</i><div><b>04</b><span>Pokretanje</span></div></div>;

const Cursor = ({action, localFrame}) => {
  if (!action) return null;
  const move = interpolate(localFrame, [22, 48], [0, 1], clamp);
  const left = interpolate(move, [0, 1], [action.from[0], action.to[0]]);
  const top = interpolate(move, [0, 1], [action.from[1], action.to[1]]);
  const click = interpolate(localFrame, [action.click - 4, action.click + 3, action.click + 18], [0, 1, 0], clamp);
  return <><div className="demo-cursor" style={{left, top}}/><div className="demo-click" style={{left: action.to[0] - 19, top: action.to[1] - 19, opacity: click, transform: `scale(${1 + click * .65})`}}/></>;
};

const AiInteraction = ({localFrame}) => {
  const question = 'Napiši samo jednu rečenicu: koja je najvažnija provjera prije otvaranja malog bistroa na ovoj lokaciji?';
  const count = Math.floor(interpolate(localFrame, [52, 132], [0, question.length], clamp));
  const answer = interpolate(localFrame, [165, 180], [0, 1], clamp);
  return <><div className="ai-question" style={{opacity: interpolate(localFrame, [42, 52], [0, 1], clamp)}}>{question.slice(0, count)}<i/></div><div className="ai-status" style={{opacity: interpolate(localFrame, [138, 148, 162, 170], [0, 1, 1, 0], clamp)}}>KUNA AI čita kontekst karte…</div><div className="ai-response" style={{opacity: answer, transform: `translateY(${interpolate(answer, [0, 1], [14, 0])}px)`}}><b>ODGOVOR · OLLAMA (LOKALNO) · QWEN2.5:3B</b><span>Broj konkurentskih poslova i dostupnost parkiranja je najvažnija provjera prije otvaranja malog bistroa na ovoj lokaciji.</span></div></>;
};

const ProductDemo = ({scene}) => {
  const frame = useCurrentFrame();
  const localFrame = Math.max(0, frame - scene.start);
  const zoom = interpolate(localFrame, [0, 22], [scene.scale - .08, scene.scale], clamp);
  return <div className="product-demo"><div className="demo-stage" style={{transform: `scale(${zoom})`, transformOrigin: scene.origin}}><Img src={staticFile(scene.background || scene.shot)} />{scene.modalCrop && <div className="modal-crop" style={{left: scene.modalCrop.left, top: scene.modalCrop.top, width: scene.modalCrop.width, height: scene.modalCrop.height}}><Img src={staticFile(scene.shot)} style={{transform: `translate(${-scene.modalCrop.left}px, ${-scene.modalCrop.top}px)`}}/></div>}<Cursor action={scene.action} localFrame={localFrame}/>{scene.ai && <AiInteraction localFrame={localFrame}/>}</div></div>;
};

const Visual = ({kind, scene}) => {
  if (kind === 'demo') return <ProductDemo scene={scene}/>;
  if (kind === 'opening' || kind === 'closing') return <div className="hero-visual"><Mark/><div className="ring ring-a"/><div className="ring ring-b"/><div className="hero-map"><MiniMap mode="hero"/></div></div>;
  if (kind === 'problem') return <div className="problem-visual"><div className="fragment f-one">KARTA</div><div className="fragment f-two">DEMOGRAFIJA</div><div className="fragment f-three">KONKURENCIJA</div><div className="fragment f-four">PRISTUP</div><div className="scatter-line"/></div>;
  if (kind === 'map') return <MiniMap mode="wide"/>;
  if (kind === 'signals') return <div className="signal-visual"><Numbers/><DataRail/></div>;
  if (kind === 'insight') return <div className="insight-visual"><MiniMap mode="insight"/><div className="insight-card"><small>PROSTOR ZA TEST</small><b>Pristup + aktivnost<br/>uz manje ponude</b><span>Čitaj odnos signala, ne samo broj točaka.</span></div></div>;
  if (kind === 'ai') return <div className="ai-visual"><AiPanel/><div className="context-card"><small>KONTEKST KOJI MODEL VIDI</small><span>grad · profil · dohvat · agregirani signali</span></div></div>;
  return <Flow/>;
};

const Scene = ({scene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (scene.kind === 'demo') {
    const localFrame = Math.max(0, frame - scene.start);
    const duration = scene.end - scene.start;
    return <div className="scene demo" style={{opacity: interpolate(localFrame, [0, 12, duration - 12, duration], [0, 1, 1, 0], clamp)}}><ProductDemo scene={scene}/></div>;
  }
  const progress = spring({frame: Math.max(0, frame - scene.start), fps, config: {damping: 120, stiffness: 85}});
  const words = scene.title.map((line, index) => <span key={line} style={{opacity: interpolate(frame,[scene.start + 18 + index * 8, scene.start + 36 + index * 8],[0,1],clamp), transform:`translateY(${interpolate(frame,[scene.start + 18 + index * 8,scene.start + 36 + index * 8],[36,0],clamp)}px)`}}>{line}</span>);
  return <div className={`scene ${scene.kind}`} style={reveal(frame, scene.start, scene.end)}>
    <div className="scene-meta"><span>{scene.index}</span><i/><b>{scene.eyebrow}</b></div>
    <div className="copy"><h1>{words}</h1><p>{scene.copy}</p><div className="progress"><i style={{transform:`scaleX(${progress})`}}/></div></div>
    <div className="visual"><Visual kind={scene.kind} scene={scene}/></div>
  </div>;
};

export const KunaPitch = () => <AbsoluteFill className="canvas"><Ambient/>{scenes.map(scene=><Scene scene={scene} key={scene.index}/>)}</AbsoluteFill>;
