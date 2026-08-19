const STORAGE_KEY = "guided-character-builder-v1";
const STEPS = [
  {title:"先认识你的角色",nav:"概念"},{title:"分配六项属性",nav:"属性"},{title:"选择你的来处",nav:"背景"},
  {title:"选择初始学派",nav:"学派"},{title:"分配学派与兼修",nav:"节点与兼修"},{title:"整理训练与熟练",nav:"熟练"},
  {title:"准备初始装备",nav:"装备"},{title:"记录成长专长",nav:"专长"},{title:"角色卡已成形",nav:"完成"}
];

const $ = s => document.querySelector(s);
const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const uniq = list => [...new Set(list.filter(Boolean))];
const mod = score => Math.floor((score - 10) / 2);
const signed = value => `${value >= 0 ? "+" : ""}${value}`;
const schoolById = id => SCHOOLS.find(s => s.id === id);
const backgroundById = id => BACKGROUNDS.find(b => b.id === id);

function freshState(){
  return {
    version:1,step:0,maxStep:0,name:"",player:"",pronouns:"",origin:"outer",concept:"",role:"",reason:"",fear:"",contact:"",tokenImage:"",
    stats:Object.fromEntries(ATTRIBUTES.map(a=>[a,8])),backgroundId:"",backgroundSkills:[],backgroundTool:"",backgroundWeapon:"",
    bgBonuses:Object.fromEntries(ATTRIBUTES.map(a=>[a,0])),entanglement:"",schoolId:"",schoolSkills:[],schoolLanguage:"",
    totalOP:1,schoolNodes:{},schoolOrder:[],activeSchoolId:"",armor:"none",shield:false,weapon:"",pack:"",money:"",gold:"",guideFee:false,equipmentNotes:"",
    rewards:[],featFilter:"全部",
    customBackground:{name:"自创背景",attrs:[],skills:[],saves:["敏捷","智力"],tools:[""],weapons:[],item:"",feature:"",featureText:""}
  };
}

function loadState(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(!saved || saved.version!==1) return freshState();
    const base=freshState();
    const merged={...base,...saved,stats:{...base.stats,...saved.stats},bgBonuses:{...base.bgBonuses,...saved.bgBonuses},customBackground:{...base.customBackground,...saved.customBackground},schoolNodes:{...(saved.schoolNodes||{})}};
    if(merged.schoolId){
      if(!merged.schoolOrder?.length)merged.schoolOrder=[merged.schoolId];
      if(!merged.schoolNodes[merged.schoolId])merged.schoolNodes[merged.schoolId]=Array.isArray(saved.nodes)&&saved.nodes.length?saved.nodes:["基石"];
      if(!merged.activeSchoolId)merged.activeSchoolId=merged.schoolId;
    }
    return merged;
  }catch{return freshState();}
}
let state=loadState();

function saveState(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),1900);}
function safeTokenImage(value){return /^data:image\/(?:png|jpeg|webp);base64,/i.test(value||"")?value:"";}
function tokenMarkup(extraClass=""){
  const image=safeTokenImage(state.tokenImage);
  return `<div class="token-avatar ${extraClass}">${image?`<img src="${image}" alt="${esc(state.name||'角色')}的角色形象">`:'<span>✦</span>'}</div>`;
}
function currentBackground(){
  if(state.backgroundId!=="custom") return backgroundById(state.backgroundId);
  const c=state.customBackground;
  return {id:"custom",type:state.origin,name:c.name||"自创背景",attrs:c.attrs,skills:c.skills,saves:c.saves,tools:c.tools.filter(Boolean),weapons:c.weapons,item:c.item,feature:c.feature||"自定义特性",featureText:c.featureText};
}
function currentSchool(){return schoolById(state.schoolId);}
function activeSchool(){return schoolById(state.activeSchoolId)||currentSchool();}
function nodesFor(schoolId){return state.schoolNodes[schoolId]||[];}
function learnedSchoolIds(){return (state.schoolOrder||[]).filter(id=>nodeSpentFor(id)>0);}
function conflictBetween(a,b){return SCHOOL_CONFLICTS.find(c=>c.schools.includes(a)&&c.schools.includes(b));}
function nodeSpentFor(schoolId){const school=schoolById(schoolId);return school?school.nodes.filter(n=>nodesFor(schoolId).includes(n.id)).reduce((sum,n)=>sum+(Number.isFinite(n.cost)?n.cost:0),0):0;}
function mainSchoolId(allocations=null){
  const ids=state.schoolOrder?.length?state.schoolOrder:[state.schoolId].filter(Boolean),spent=id=>allocations?.[id]??nodeSpentFor(id);
  return ids.reduce((best,id)=>!best||spent(id)>spent(best)?id:best,ids[0]||"");
}
function mainSchool(){return schoolById(mainSchoolId());}
function lightCapFor(schoolId,allocations=null){
  const mainId=mainSchoolId(allocations);if(!mainId||schoolId===mainId)return Infinity;
  return conflictBetween(mainId,schoolId)?.type==="light"?Math.floor((allocations?.[mainId]??nodeSpentFor(mainId))/2):Infinity;
}
function allocationIssues(allocations=null){
  const ids=(state.schoolOrder||[]).filter(id=>(allocations?.[id]??nodeSpentFor(id))>0),issues=[];
  for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const c=conflictBetween(ids[i],ids[j]);if(c?.type==="heavy")issues.push(`${schoolById(ids[i]).name}与${schoolById(ids[j]).name}存在重度冲突`);}
  const mainId=mainSchoolId(allocations);ids.forEach(id=>{const spent=allocations?.[id]??nodeSpentFor(id),cap=lightCapFor(id,allocations);if(id!==mainId&&spent>cap)issues.push(`${schoolById(id).name}投入 ${spent} OP，超过轻度冲突上限 ${cap} OP`);});
  return issues;
}
function backgroundBonusTotal(){return Object.values(state.bgBonuses).reduce((a,b)=>a+b,0);}
function rewardSlots(){return [4,8,12,16].filter(v=>state.totalOP>=v).length;}
function normalizedRewards(){while(state.rewards.length<rewardSlots())state.rewards.push({type:"",feat:"",attr1:"",attr2:""});if(state.rewards.length>rewardSlots())state.rewards.length=rewardSlots();return state.rewards;}
function rewardBonuses(){
  const out=Object.fromEntries(ATTRIBUTES.map(a=>[a,0]));
  normalizedRewards().forEach(r=>{if(r.type==="asi2"&&r.attr1)out[r.attr1]+=2;if(r.type==="asi11"){if(r.attr1)out[r.attr1]+=1;if(r.attr2)out[r.attr2]+=1;}});
  return out;
}
function finalStats(){const rb=rewardBonuses();return Object.fromEntries(ATTRIBUTES.map(a=>[a,Math.min(20,state.stats[a]+state.bgBonuses[a]+rb[a])]))}
function pointSpent(){return ATTRIBUTES.reduce((sum,a)=>sum+POINT_COSTS[state.stats[a]],0);}
function profBonus(){const op=Math.max(1,+state.totalOP||1);return op>=17?6:op>=13?5:op>=9?4:op>=5?3:2;}
function selectedNodeObjects(schoolId=null){
  if(schoolId){const s=schoolById(schoolId);return s?s.nodes.filter(n=>nodesFor(schoolId).includes(n.id)):[];}
  return (state.schoolOrder||[]).flatMap(id=>selectedNodeObjects(id).map(n=>({...n,schoolId:id})));
}
function nodeSpent(){return (state.schoolOrder||[]).reduce((sum,id)=>sum+nodeSpentFor(id),0);}
function backgroundSave(){
  const bg=currentBackground(),school=currentSchool();if(!bg||!school)return "";
  const schoolIsCommon=COMMON_SAVES.includes(school.save);
  return bg.saves.find(s=>schoolIsCommon?SPECIAL_SAVES.includes(s):COMMON_SAVES.includes(s))||"";
}
function allSkills(){return uniq([...state.backgroundSkills,...state.schoolSkills]);}
function allWeapons(){const school=currentSchool();return uniq(["徒手／拳套",state.backgroundWeapon,...(school?.weapons||[])]);}
function allToolsLanguages(){const school=currentSchool();return uniq([state.backgroundTool,school?.tool,state.schoolLanguage]);}
function hpMax(){
  const school=currentSchool();if(!school)return 0;const c=mod(finalStats().体质);const growth={6:4,8:5,10:6}[school.hitDie];
  return school.hitDie+c+Math.max(0,state.totalOP-1)*Math.max(1,growth+c);
}
function armorClass(){
  const armor=ARMORS.find(a=>a.id===state.armor)||ARMORS[0],dex=mod(finalStats().敏捷);
  const dexPart=armor.dex==="full"?dex:Math.min(2,dex);return armor.base+dexPart+(state.shield?2:0);
}
function schoolAttack(schoolId=state.schoolId){const school=schoolById(schoolId);return school?profBonus()+mod(finalStats()[school.key]):0;}
function schoolDC(schoolId=state.schoolId){const school=schoolById(schoolId);return school?8+schoolAttack(schoolId):0;}
function skillBonus(skill){return mod(finalStats()[SKILL_ATTRIBUTES[skill]])+(allSkills().includes(skill)?profBonus():0);}
function selectedWeaponData(){return WEAPONS.find(w=>w.name===state.weapon);}

function effectiveCustomReady(){const c=state.customBackground;return c.name&&c.attrs.length===3&&c.skills.length===4&&c.saves.length===2&&c.tools[0]&&c.weapons.length===3&&c.item&&c.feature&&c.featureText;}
function stepIssues(index){
  const bg=currentBackground(),school=currentSchool(),issues=[];
  if(index===0){if(!state.name.trim())issues.push("写下角色姓名");if(!state.concept.trim())issues.push("用一句话写下角色概念");if(!state.reason.trim())issues.push("写下接触隐秘世界的原因");if(!state.contact.trim())issues.push("写下至少一名牵连人物");}
  if(index===1){if(pointSpent()!==27)issues.push(`点购需要恰好使用 27 点（当前 ${pointSpent()} 点）`);}
  if(index===2){if(!bg)issues.push("选择一项背景");if(state.backgroundId==="custom"&&!effectiveCustomReady())issues.push("补全自创背景的强度预算");if(bg&&state.backgroundSkills.length!==2)issues.push("选择 2 项背景技能");if(bg&&!state.backgroundTool)issues.push("选择 1 项背景工具或语言");if(bg&&!state.backgroundWeapon)issues.push("选择 1 项普通武器熟练");if(bg&&backgroundBonusTotal()!==2)issues.push("分配恰好 2 点背景属性加值");}
  if(index===3&&!school)issues.push("选择初始学派");
  if(index===4){if(!school)issues.push("先选择初始学派");else{if(!nodesFor(state.schoolId).includes("基石"))issues.push("初始学派必须点亮基石节点");if(nodeSpent()!==+state.totalOP)issues.push(`所有学派共使用 ${nodeSpent()} OP，需要使用 ${state.totalOP} OP`);issues.push(...allocationIssues());}}
  if(index===5){if(!school)issues.push("先选择初始学派");else{if(state.schoolSkills.length!==2)issues.push("选择 2 项学派技能");if(!state.schoolLanguage)issues.push("选择学派语言或文字");}}
  if(index===6){if(!state.weapon)issues.push("选择一件初始武器");if(!state.pack)issues.push("选择一个装备包");}
  if(index===7){normalizedRewards().forEach((r,i)=>{if(!r.type)issues.push(`完成第 ${i+1} 次成长选择`);if(r.type==="feat"&&!r.feat)issues.push(`为第 ${i+1} 次成长选择一项专长`);if(r.type==="asi2"&&!r.attr1)issues.push(`为第 ${i+1} 次成长选择属性`);if(r.type==="asi11"&&(!r.attr1||!r.attr2||r.attr1===r.attr2))issues.push(`第 ${i+1} 次成长需选择两项不同属性`);if(r.type==="feat"&&r.feat&&!featEligible(FEATS.find(f=>f.id===r.feat)).ok)issues.push(`专长“${FEATS.find(f=>f.id===r.feat)?.name}”尚不满足前置条件`);});}
  return issues;
}
function allIssues(){return STEPS.slice(0,8).flatMap((_,i)=>stepIssues(i).map(text=>({step:i,text})));}
function completion(){return Math.round((STEPS.slice(0,8).filter((_,i)=>stepIssues(i).length===0).length/8)*100);}

function renderNav(){
  $("#stepNav").innerHTML=STEPS.map((s,i)=>`<button class="step-link ${i===state.step?"active":""} ${i<state.step&&stepIssues(i).length===0?"complete":""}" data-action="goto" data-value="${i}" ${i>state.maxStep?"disabled":""}><span>${i<state.step&&stepIssues(i).length===0?"✓":i+1}</span>${s.nav}</button>`).join("");
}
function sectionHeading(title,subtitle=""){return `<div class="section-heading"><div><h2>${title}</h2>${subtitle?`<p>${subtitle}</p>`:""}</div></div>`;}
function choiceChips(items,selected,action,limit,disabled=[]){return `<div class="chip-row">${items.map(item=>`<button type="button" class="chip ${selected.includes(item)?"selected":""}" data-action="${action}" data-value="${esc(item)}" ${disabled.includes(item)&&!selected.includes(item)?"disabled":""}>${esc(item)}</button>`).join("")}</div><div class="hint" style="margin-top:7px">已选择 ${selected.length}/${limit}</div>`;}

function renderConcept(){
  const roles=["近战前排","远程输出","支援控制","调查解谜","召唤随从","高风险能力"];
  return `<p class="intro-copy">你不需要先读完整本规则。回答几个问题，我们会把一个模糊的角色念头逐步整理成可直接上桌的角色卡。</p>
  <div class="field-grid"><div class="field"><label>角色姓名</label><input data-bind="name" value="${esc(state.name)}" placeholder="暂时没有也可以先写代号"></div><div class="field"><label>玩家姓名</label><input data-bind="player" value="${esc(state.player)}" placeholder="可选"></div>
  <div class="field wide"><label>角色形象／Token（可选）</label><div class="token-uploader">${tokenMarkup("token-avatar-upload")}<div class="token-upload-copy"><b>${state.tokenImage?'角色形象已加入':'加入角色形象'}</b><p>上传 PNG、JPG 或 WebP。图片会自动裁切为方形并压缩，随存档和独立角色卡一起导出。</p><div class="token-actions"><label class="ghost-button" for="tokenFile">${state.tokenImage?'更换图片':'选择图片'}</label>${state.tokenImage?'<button type="button" class="ghost-button danger-button" data-action="removeToken">移除</button>':''}<input id="tokenFile" type="file" accept="image/png,image/jpeg,image/webp" hidden></div></div></div></div>
  <div class="field wide"><label>你与隐秘世界的距离</label><div class="choice-row"><button class="choice-card ${state.origin==='outer'?'selected':''}" data-action="origin" data-value="outer"><b>门外人</b><small>你原本生活在世俗秩序中，适合第一次接触本规则的玩家。</small></button><button class="choice-card ${state.origin==='inner'?'selected':''}" data-action="origin" data-value="inner"><b>门内人</b><small>你曾为秘社、仪式团体、藏书人或驱魔人做过事。</small></button></div></div>
  <div class="field wide"><label>一句话角色概念</label><input data-bind="concept" value="${esc(state.concept)}" placeholder="例如：收到亡兄来信的乡村医生"></div>
  <div class="field wide"><label>你希望在队伍中承担什么位置？</label>${choiceChips(roles,state.role?[state.role]:[],"role",1)}</div>
  <div class="field wide"><label>是什么把你带进隐秘世界？</label><textarea data-bind="reason" rows="3" placeholder="一次事故、一笔债、一本书，或一个失踪的人……">${esc(state.reason)}</textarea></div>
  <div class="field"><label>你最害怕付出什么代价？</label><input data-bind="fear" value="${esc(state.fear)}" placeholder="失去自我、记忆、信仰……"></div><div class="field"><label>谁仍然与你有关？</label><input data-bind="contact" value="${esc(state.contact)}" placeholder="写下一个名字与关系"></div></div>`;
}
function renderStats(){
  const remain=27-pointSpent(),school=currentSchool(),final=finalStats();
  return `<p class="intro-copy">从 8 开始购买属性。点购阶段最高 15；背景稍后会再提供 2 点加值，开卡时单项最高 17。</p>
  <div class="stat-toolbar"><div class="point-pool ${remain<0?'over':''}"><b>${remain}</b><span>点剩余</span></div><div class="choice-row"><button class="ghost-button" data-action="recommendedStats">推荐分配</button><button class="ghost-button" data-action="resetStats">全部重置</button></div></div>
  <div class="stat-grid">${ATTRIBUTES.map(a=>`<div class="stat-card ${school?.key===a?'primary':''}"><div class="stat-head"><b>${a}</b><small>${school?.key===a?'学派关键属性':`调整值 ${signed(mod(final[a]))}`}</small></div><div class="stat-controls"><button class="icon-button" data-action="statDown" data-value="${a}" ${state.stats[a]<=8?'disabled':''}>−</button><div class="stat-value">${state.stats[a]}${state.bgBonuses[a]?`<span class="bonus-dot">+${state.bgBonuses[a]}</span>`:''}</div><button class="icon-button" data-action="statUp" data-value="${a}" ${state.stats[a]>=15?'disabled':''}>+</button></div><div class="stat-foot"><span>花费 ${POINT_COSTS[state.stats[a]]}</span><span>最终 ${final[a]}</span></div></div>`).join("")}</div>
  <div class="notice">知性用于直觉、警觉与内在判断；灵恩用于感召、仪式权威与非人交涉。作为技能名称的“察觉”保持不变。</div>`;
}

function renderCustomBuilder(){
  const c=state.customBackground;
  return `<div class="detail-panel"><div class="detail-head"><h3>自创背景规则向导</h3><span class="tag ${effectiveCustomReady()?'green':'gold'}">${effectiveCustomReady()?'预算完整':'需要补全'}</span></div><div class="detail-body"><div class="field-grid">
  <div class="field wide"><label>背景名称</label><input data-custom="name" value="${esc(c.name)}" placeholder="例如：巡回测绘员"></div>
  <div class="field wide"><label>选择 3 项属性加值选项</label>${choiceChips(ATTRIBUTES,c.attrs,"customAttr",3)}</div>
  <div class="field wide"><label>选择 4 项技能组成技能池</label>${choiceChips(ALL_SKILLS,c.skills,"customSkill",4)}</div>
  <div class="field"><label>常见防御豁免</label><select data-custom-select="save0">${COMMON_SAVES.map(a=>`<option ${c.saves[0]===a?'selected':''}>${a}</option>`).join("")}</select></div><div class="field"><label>特殊防御豁免</label><select data-custom-select="save1">${SPECIAL_SAVES.map(a=>`<option ${c.saves[1]===a?'selected':''}>${a}</option>`).join("")}</select></div>
  <div class="field wide"><label>工具或语言</label><input data-custom="tool" value="${esc(c.tools[0])}" placeholder="一项与经历直接相关的工具或语言"></div>
  <div class="field wide"><label>选择 3 项普通武器候选</label>${choiceChips(COMMON_WEAPONS,c.weapons,"customWeapon",3)}</div>
  <div class="field wide"><label>非魔法随身物</label><input data-custom="item" value="${esc(c.item)}" placeholder="纪念物、旧凭证、残缺文件或异常遗留物"></div>
  <div class="field"><label>背景特性名称</label><input data-custom="feature" value="${esc(c.feature)}" placeholder="例如：路线档案"></div><div class="field"><label>特性与明确边界</label><textarea data-custom="featureText" placeholder="写明能提供的渠道，以及不能绕过的限制">${esc(c.featureText)}</textarea></div>
  </div></div></div>`;
}
function renderBackgroundConfig(bg){
  if(!bg)return "";const total=backgroundBonusTotal();
  return `<div class="detail-panel"><div class="detail-head"><div><span class="eyebrow">BACKGROUND TRAINING</span><h3>${esc(bg.name)}</h3></div><span class="tag gold">${bg.type==='inner'?'门内':'门外'}</span></div><div class="detail-body">
  <div class="info-grid"><div class="info-cell"><small>豁免组合</small><b>${bg.saves.join('／')}</b></div><div class="info-cell"><small>随身物</small><b>${esc(bg.item||'尚未填写')}</b></div><div class="info-cell"><small>最终背景豁免</small><b>${backgroundSave()||'选择学派后自动决定'}</b></div></div>
  <div class="feature-box"><b>${esc(bg.feature)}</b><p>${esc(bg.featureText)}</p></div>
  ${sectionHeading("分配背景属性",`从列出的 3 项属性中分配 2 点；已分配 ${total}/2`)}
  <div class="stat-grid">${bg.attrs.map(a=>`<div class="stat-card"><div class="stat-head"><b>${a}</b><small>开卡上限 17</small></div><div class="stat-controls"><button class="icon-button" data-action="bonusDown" data-value="${a}" ${state.bgBonuses[a]<=0?'disabled':''}>−</button><div class="stat-value">+${state.bgBonuses[a]}</div><button class="icon-button" data-action="bonusUp" data-value="${a}" ${(total>=2||state.stats[a]+state.bgBonuses[a]>=17)?'disabled':''}>+</button></div></div>`).join("")}</div>
  ${sectionHeading("背景技能","从技能池中选择 2 项")}${choiceChips(bg.skills,state.backgroundSkills,"backgroundSkill",2)}
  <div class="field-grid" style="margin-top:20px"><div class="field"><label>工具或语言</label><select data-select="backgroundTool"><option value="">请选择</option>${bg.tools.map(x=>`<option ${state.backgroundTool===x?'selected':''}>${esc(x)}</option>`).join("")}</select></div><div class="field"><label>普通武器熟练</label><select data-select="backgroundWeapon"><option value="">请选择</option>${bg.weapons.map(x=>`<option ${state.backgroundWeapon===x?'selected':''}>${esc(x)}</option>`).join("")}</select></div><div class="field wide"><label>仍未摆脱的牵连</label><textarea data-bind="entanglement" placeholder="旧关系、债务、秘密、禁忌、追查者或一次异常事故……">${esc(state.entanglement)}</textarea></div></div>
  </div></div>`;
}
function renderBackground(){
  const available=BACKGROUNDS.filter(b=>b.type===state.origin),bg=currentBackground();
  return `<p class="intro-copy">背景说明你在成为实践者之前是谁。它会提供 2 项技能、1 项工具或语言、1 项普通武器和一项与学派互补的豁免。</p>
  <div class="card-grid">${available.map(b=>`<button class="option-card ${state.backgroundId===b.id?'selected':''}" data-action="background" data-value="${b.id}"><h3>${b.name}</h3><p>${b.featureText}</p><div class="meta"><span class="tag">${b.attrs.join(' · ')}</span><span class="tag">${b.skills.slice(0,2).join(' · ')}…</span></div>${state.backgroundId===b.id?'<span class="selected-mark">◆</span>':''}</button>`).join("")}<button class="option-card ${state.backgroundId==='custom'?'selected':''}" data-action="background" data-value="custom"><h3>自创背景</h3><p>按同一强度预算，由向导逐项检查属性、技能、豁免、工具、武器、随身物与特性边界。</p><div class="meta"><span class="tag gold">主持人确认</span></div>${state.backgroundId==='custom'?'<span class="selected-mark">◆</span>':''}</button></div>
  ${state.backgroundId==='custom'?renderCustomBuilder():''}${bg?renderBackgroundConfig(bg):''}`;
}

function roleMatches(id){const map={"近战前排":["spiritdrum","sufi","solomon"],"远程输出":["alchemy","astrology","runes"],"支援控制":["astrology","kabbalah","sufi","spiritdrum"],"调查解谜":["alchemy","astrology","runes","deadbook"],"召唤随从":["solomon","deadbook","spiritdrum"],"高风险能力":["gnostic","kabbalah","solomon"]};return (map[state.role]||[]).includes(id);}
function renderSchool(){
  const school=currentSchool();
  return `<p class="intro-copy">初始学派决定生命骰、关键属性、核心资源和战斗方式。兼修不会再次获得这套初始训练。</p>
  ${state.role?`<div class="notice">根据你选择的“${state.role}”定位，带有“契合概念”标记的学派更容易实现这个角色想法，但这不是强制选择。</div>`:''}
  <div class="card-grid">${SCHOOLS.map(s=>`<button class="option-card ${state.schoolId===s.id?'selected':''}" data-action="school" data-value="${s.id}"><h3>${s.name}</h3><p>${s.role}</p><div class="meta"><span class="tag gold">${s.key}关键</span><span class="tag">d${s.hitDie}</span><span class="tag">复杂度 ${'●'.repeat(s.complexity)}${'○'.repeat(3-s.complexity)}</span>${roleMatches(s.id)?'<span class="tag green">契合概念</span>':''}</div>${state.schoolId===s.id?'<span class="selected-mark">◆</span>':''}</button>`).join("")}</div>
  ${school?`<div class="detail-panel"><div class="detail-head"><div><span class="eyebrow">INITIAL SCHOOL</span><h3>${school.name}</h3></div><span class="tag gold">${school.style}</span></div><div class="detail-body"><div class="info-grid"><div class="info-cell"><small>生命骰</small><b>d${school.hitDie}</b></div><div class="info-cell"><small>关键属性</small><b>${school.key}</b></div><div class="info-cell"><small>学派豁免</small><b>${school.save}</b></div><div class="info-cell"><small>武器与护甲</small><b>${school.weapons.join('、')}；${school.armor.join('、')||'无护甲'}</b></div><div class="info-cell"><small>工具与语言</small><b>${school.tool}；${school.languages.join('／')}</b></div><div class="info-cell"><small>初始器具</small><b>${school.implements}</b></div></div></div></div>`:''}`;
}

function prereqsMet(nodeObj,schoolId=state.activeSchoolId){
  const selected=nodesFor(schoolId);
  if(nodeObj.pre.includes("UNSPECIFIED"))return false;
  if(nodeObj.pre.includes("ALL")){const school=schoolById(schoolId);return school.nodes.filter(n=>n.id!=="冠位").every(n=>selected.includes(n.id));}
  return nodeObj.pre.every(p=>selected.includes(p));
}
function canSelectNode(nodeObj,schoolId=state.activeSchoolId){
  if(!Number.isFinite(nodeObj.cost)||!prereqsMet(nodeObj,schoolId)||nodeSpent()+nodeObj.cost>state.totalOP)return false;
  const allocations=Object.fromEntries((state.schoolOrder||[]).map(id=>[id,nodeSpentFor(id)]));allocations[schoolId]=(allocations[schoolId]||0)+nodeObj.cost;
  return allocationIssues(allocations).length===0;
}
function candidateConflict(schoolId){
  const conflicts=learnedSchoolIds().map(id=>conflictBetween(id,schoolId)).filter(Boolean);
  return conflicts.find(c=>c.type==="heavy")||conflicts.find(c=>c.type==="light")||null;
}
function renderNodes(){
  const school=activeSchool();if(!school)return `<div class="empty">请先回到上一步选择初始学派。</div>`;
  const spent=nodeSpent(),schoolSpent=nodeSpentFor(school.id),pct=Math.min(100,(spent/Math.max(1,state.totalOP))*100),main=mainSchool(),unselected=SCHOOLS.filter(s=>!(state.schoolOrder||[]).includes(s.id));
  return `<p class="intro-copy">总 OP 可以分配到多门学派。初始学派只决定角色底盘；投入 OP 最高的学派是当前主学派。兼修不会再次获得生命骰或学派训练。</p>
  <div class="stat-toolbar"><div class="node-budget"><div class="op-input"><label for="opInput">总 OP</label><input id="opInput" type="number" min="1" max="30" value="${state.totalOP}" data-select="totalOP"></div><div class="budget-meter"><i class="${spent>state.totalOP?'over':''}" style="width:${pct}%"></i></div><div class="point-pool ${spent>state.totalOP?'over':''}"><b>${spent}</b><span>/ ${state.totalOP} 已使用</span></div></div><button class="ghost-button" data-action="autoNodes">自动填充</button></div>
  <div class="summary-strip"><div class="summary-box"><small>初始学派</small><b>${currentSchool().name}</b></div><div class="summary-box"><small>当前主学派</small><b>${main?.name||'—'}</b></div><div class="summary-box"><small>已掌握学派</small><b>${learnedSchoolIds().length}</b></div><div class="summary-box"><small>剩余 OP</small><b>${state.totalOP-spent}</b></div></div>
  ${allocationIssues().length?`<div class="notice danger">${allocationIssues().join('；')}</div>`:''}
  ${sectionHeading("OP 分配","点击学派切换对应节点树")}
  <div class="school-tabs">${(state.schoolOrder||[]).map(id=>{const s=schoolById(id),op=nodeSpentFor(id),conf=id===main?.id?null:conflictBetween(main?.id,id);return `<div class="school-tab ${school.id===id?'active':''}"><button data-action="activeSchool" data-value="${id}"><b>${s.name}</b><small>${op} OP ${id===state.schoolId?'· 初始':''} ${id===main?.id?'· 主学派':''} ${conf?.type==='light'?`· 上限 ${lightCapFor(id)} OP`:''}</small></button>${id!==state.schoolId?`<button class="school-remove" data-action="removeSchool" data-value="${id}" aria-label="移除${s.name}">×</button>`:''}</div>`}).join("")}</div>
  ${unselected.length?`${sectionHeading("增加兼修学派","重度冲突无法同时投入 OP；轻度冲突受到主学派一半的上限约束")}<div class="card-grid">${unselected.map(s=>{const c=candidateConflict(s.id),heavy=c?.type==='heavy';return `<button class="option-card ${heavy?'disabled':''}" data-action="addSchool" data-value="${s.id}" ${heavy?'disabled':''}><h3>${s.name}</h3><p>${c?c.reason:'未列入冲突表，可以正常兼修。'}</p><div class="meta"><span class="tag ${heavy?'red':c?'gold':'green'}">${heavy?'重度冲突':c?'轻度冲突':'无冲突'}</span><span class="tag">${s.key}关键</span></div></button>`}).join("")}</div>`:''}
  ${sectionHeading(`${school.name}节点`,`${schoolSpent} OP · ${school.id===state.schoolId?'初始学派':'兼修学派，不提供初始训练'}`)}
  ${school.id==='deadbook'?'<div class="notice danger">《亡灵书：构魂术》的冠位节点目前没有明确 OP 消耗与前置条件，因此工具会保留显示，但不会自动允许购买。</div>':''}
  <div class="node-grid">${school.nodes.map(n=>{const selected=nodesFor(school.id).includes(n.id),enabled=selected||canSelectNode(n,school.id),fixed=school.id===state.schoolId&&n.id==='基石';return `<button class="node-card ${selected?'selected':''}" data-action="node" data-school="${school.id}" data-value="${n.id}" ${fixed||(!enabled&&!selected)?'disabled':''}><span class="node-id">${n.id}</span><span class="node-cost">${n.cost??'待定'} OP</span><h3>${n.name}</h3><p>${n.theme}</p><div class="node-pre">前置：${n.pre.length?n.pre.join('、'):'无'}${selected?' · 已点亮':''}</div></button>`}).join("")}</div>`;
}

function renderProficiencies(){
  const school=currentSchool(),bg=currentBackground();if(!school||!bg)return `<div class="empty">请先完成背景与初始学派选择。</div>`;
  const disabled=state.backgroundSkills.filter(s=>school.skills.includes(s));
  return `<p class="intro-copy">背景与初始学派各提供 2 项技能。若发生重复，从学派列表中改选另一项尚未熟练的技能。</p>
  <div class="summary-strip"><div class="summary-box"><small>熟练加值</small><b>${signed(profBonus())}</b></div><div class="summary-box"><small>背景豁免</small><b>${backgroundSave()}</b></div><div class="summary-box"><small>学派豁免</small><b>${school.save}</b></div><div class="summary-box"><small>技能总数</small><b>${allSkills().length}/4</b></div></div>
  ${sectionHeading("选择学派技能","选择 2 项；与背景技能重复的选项已锁定")}${choiceChips(school.skills,state.schoolSkills,"schoolSkill",2,disabled)}
  ${sectionHeading("学派语言或文字",school.languages.length>1?'从学派提供的选项中选择 1 项':'自动记录')}${choiceChips(school.languages,state.schoolLanguage?[state.schoolLanguage]:[],"schoolLanguage",1)}
  <div class="detail-panel"><div class="detail-head"><h3>训练汇总</h3><span class="tag green">仅初始学派提供</span></div><div class="detail-body"><div class="info-grid"><div class="info-cell"><small>技能</small><b>${allSkills().join('、')||'尚未选完'}</b></div><div class="info-cell"><small>豁免</small><b>${uniq([backgroundSave(),school.save]).join('、')}</b></div><div class="info-cell"><small>武器</small><b>${allWeapons().join('、')}</b></div><div class="info-cell"><small>护甲</small><b>${school.armor.join('、')||'无'}</b></div><div class="info-cell"><small>工具／语言</small><b>${allToolsLanguages().join('、')}</b></div><div class="info-cell"><small>初始器具</small><b>${school.implements}</b></div></div></div></div>`;
}

function allowedArmors(){const s=currentSchool();if(!s)return [ARMORS[0]];if(s.armor.includes("中甲"))return ARMORS;if(s.armor.includes("轻甲"))return ARMORS.filter(a=>a.type==="无"||a.type==="轻甲");return [ARMORS[0]];}
function renderEquipment(){
  const school=currentSchool();if(!school)return `<div class="empty">请先完成初始学派选择。</div>`;
  const weapons=WEAPONS.filter(w=>allWeapons().includes(w.name));
  return `<p class="intro-copy">你可以从自己熟练的非魔法武器与护甲中选择初始装备。完整价格、管制与材料规则仍由主持人按时代决定。</p>
  ${sectionHeading("初始武器","仅显示你已经熟练的武器")}
  <div class="weapon-list">${weapons.map(w=>`<div class="weapon-row ${state.weapon===w.name?'selected':''}" data-action="weapon" data-value="${esc(w.name)}"><span class="radio-dot"></span><span class="weapon-name">${w.name}</span><b>${w.damage}</b><span>${w.type}</span><span class="weapon-tags">${w.tagsText}</span><span class="weapon-reg">${w.regulation}</span></div>`).join("")}</div>
  <div class="field-grid" style="margin-top:22px"><div class="field"><label>初始护甲</label><select data-select="armor">${allowedArmors().map(a=>`<option value="${a.id}" ${state.armor===a.id?'selected':''}>${a.name}</option>`).join("")}</select></div><div class="field"><label>盾牌</label><select data-select="shield" ${school.armor.includes('盾牌')?'':'disabled'}><option value="false" ${!state.shield?'selected':''}>不携带</option><option value="true" ${state.shield?'selected':''}>携带盾牌（AC +2）</option></select></div><div class="field wide"><label>装备包</label>${choiceChips(PACKS,state.pack?[state.pack]:[],"pack",1)}</div></div>
  ${sectionHeading("起始资金",state.origin==='outer'?'门外人：4d6 × 100 世俗资金，0 金币':'门内人：3d6 × 10 世俗资金，1d4 金币')}
  <div class="field-grid"><div class="field"><label>世俗资金</label><input data-bind="money" value="${esc(state.money)}" placeholder="点击右侧按钮掷骰"></div><div class="field"><label>金币</label><input data-bind="gold" value="${esc(state.gold)}"></div></div><div class="choice-row" style="margin-top:10px"><button class="ghost-button" data-action="rollFunds">掷起始资金</button>${state.origin==='outer'?`<button class="choice-card ${state.guideFee?'selected':''}" style="flex:0 1 320px;padding:10px 13px" data-action="guideFee"><b>引路费</b><small>世俗资金 -50，获得 1 金币，并额外承担一条债务牵连。</small></button>`:''}</div>
  <div class="field wide" style="margin-top:18px"><label>其他装备与时代替换</label><textarea data-bind="equipmentNotes" placeholder="普通工具、文件、弹药、时代替代品或主持人批准的调整……">${esc(state.equipmentNotes)}</textarea></div>`;
}

function weaponHasTag(tag){return WEAPONS.filter(w=>allWeapons().includes(w.name)).some(w=>w.tags.some(t=>t===tag||t.startsWith(tag+" ")));}
function featEligible(feat){
  if(!feat)return {ok:false,text:"未知专长"};const stats=finalStats();let ok=true;
  if(feat.req==="school")ok=nodeSpent()>0;
  if(feat.req==="stat")ok=stats[feat.stat]>=feat.min;
  if(feat.req==="tag")ok=weaponHasTag(feat.tag);
  if(feat.req==="tagEither")ok=feat.tags.some(weaponHasTag);
  if(feat.req==="tagsAll")ok=WEAPONS.filter(w=>allWeapons().includes(w.name)).some(w=>feat.tags.every(t=>w.tags.some(x=>x===t||x.startsWith(t+" "))));
  if(feat.req==="heavy")ok=stats.力量>=13&&weaponHasTag("重型");
  if(feat.req==="occultSkill")ok=allSkills().some(x=>["奥秘","宗教","仪礼"].includes(x))||allToolsLanguages().some(Boolean);
  if(feat.req==="secretLanguage")ok=allToolsLanguages().some(x=>/语|拉丁|希腊|科普特|叙利亚|希伯来|阿拉伯|波斯|土耳其|以诺|请灵/.test(x));
  if(feat.req==="martial")ok=nodeSpent()>0&&allWeapons().some(x=>!COMMON_WEAPONS.includes(x)&&x!=="徒手／拳套");
  if(feat.req==="manual")ok=true;
  return {ok,text:feat.reqText||"无"};
}
function selectedFeatIds(){return normalizedRewards().filter(r=>r.type==="feat").map(r=>r.feat).filter(Boolean);}
function renderRewardSlot(r,i){
  return `<div class="reward-slot"><b>${[4,8,12,16][i]} OP</b><div><select class="compact-select" data-reward="type" data-index="${i}"><option value="" ${!r.type?'selected':''}>选择奖励</option><option value="feat" ${r.type==='feat'?'selected':''}>选择一项专长</option><option value="asi2" ${r.type==='asi2'?'selected':''}>一项属性 +2</option><option value="asi11" ${r.type==='asi11'?'selected':''}>两项属性各 +1</option></select>${r.type==='feat'?`<select class="compact-select" style="margin-top:7px" data-reward="feat" data-index="${i}"><option value="">选择专长</option>${FEATS.map(f=>{const e=featEligible(f);return `<option value="${f.id}" ${r.feat===f.id?'selected':''} ${(!e.ok||selectedFeatIds().includes(f.id)&&r.feat!==f.id)?'disabled':''}>${f.name}${e.ok?'':'（前置未满足）'}</option>`}).join("")}</select>`:''}${r.type==='asi2'?`<select class="compact-select" style="margin-top:7px" data-reward="attr1" data-index="${i}"><option value="">选择属性</option>${ATTRIBUTES.map(a=>`<option ${r.attr1===a?'selected':''}>${a}</option>`).join("")}</select>`:''}${r.type==='asi11'?`<div class="choice-row" style="margin-top:7px"><select class="compact-select" data-reward="attr1" data-index="${i}"><option value="">第一项</option>${ATTRIBUTES.map(a=>`<option ${r.attr1===a?'selected':''}>${a}</option>`).join("")}</select><select class="compact-select" data-reward="attr2" data-index="${i}"><option value="">第二项</option>${ATTRIBUTES.map(a=>`<option ${r.attr2===a?'selected':''}>${a}</option>`).join("")}</select></div>`:''}</div></div>`;
}
function renderFeats(){
  const slots=rewardSlots(),filters=["全部","通用","战斗","秘仪"],list=FEATS.filter(f=>state.featFilter==="全部"||f.category===state.featFilter);
  return `<p class="intro-copy">角色总 OP 达到 4、8、12、16 时，各获得一次成长选择：选择一项满足前置的专长，或选择属性提升。</p>
  ${slots===0?'<div class="empty">你当前为 1–3 OP，尚未获得专长选择。提高“学派节点”步骤中的总 OP 后，这里会自动出现成长栏位。</div>':`<div>${normalizedRewards().map(renderRewardSlot).join("")}</div>`}
  ${sectionHeading("专长图鉴","不满足前置条件的条目会保留显示，方便规划后续成长")}
  <div class="feat-tabs">${filters.map(f=>`<button class="chip ${state.featFilter===f?'selected':''}" data-action="featFilter" data-value="${f}">${f}</button>`).join("")}</div>
  <div class="card-grid">${list.map(f=>{const eligible=featEligible(f),picked=selectedFeatIds().includes(f.id);return `<button class="option-card feat-card ${eligible.ok?'eligible':''} ${picked?'selected':''}" data-action="feat" data-value="${f.id}" ${slots===0||!eligible.ok?'disabled':''}><h3>${f.name}</h3><p>${f.desc}</p><div class="requirement">${eligible.ok?'✓':'○'} ${eligible.text||'无前置'}</div><div class="meta"><span class="tag">${f.category}</span>${f.req==='manual'?'<span class="tag gold">需确认</span>':''}</div>${picked?'<span class="selected-mark">◆</span>':''}</button>`}).join("")}</div>`;
}

function checkList(items){return `<div class="check-list">${items.map(i=>`<div class="check-item ${i.ok?'ok':'warn'}"><span class="check-icon">${i.ok?'✓':'!'}</span><span>${esc(i.text)}</span></div>`).join("")}</div>`;}
function fullSheet(){
  const bg=currentBackground(),school=currentSchool(),stats=finalStats(),weapon=selectedWeaponData(),rewards=normalizedRewards();
  return `<div class="sheet-full"><div class="sheet-full-head"><div class="sheet-identity">${tokenMarkup("token-avatar-sheet")}<div><span class="eyebrow">CHARACTER RECORD</span><h2>${esc(state.name||'未命名角色')}</h2><div class="preview-subtitle">${esc(state.concept||'尚未填写角色概念')}</div></div></div><div style="text-align:right"><b>${school?.name||'未选学派'}</b><div class="preview-subtitle">${bg?.name||'未选背景'} · ${state.totalOP} OP</div></div></div>
  <div class="summary-strip" style="margin-top:15px"><div class="summary-box"><small>生命值</small><b>${hpMax()||'—'}</b></div><div class="summary-box"><small>护甲等级</small><b>${armorClass()}</b></div><div class="summary-box"><small>先攻</small><b>${signed(mod(stats.敏捷))}</b></div><div class="summary-box"><small>熟练加值</small><b>${signed(profBonus())}</b></div></div>
  <div class="preview-stat">${ATTRIBUTES.map(a=>`<div><b>${stats[a]}</b><small>${a} ${signed(mod(stats[a]))}</small></div>`).join("")}</div>
  <div class="sheet-columns"><div class="sheet-block"><h3>身份与牵连</h3><p>${state.origin==='inner'?'门内人':'门外人'}。${esc(state.reason)}</p><p><b>恐惧：</b>${esc(state.fear||'—')}<br><b>关系：</b>${esc(state.contact||'—')}<br><b>牵连：</b>${esc(state.entanglement||'—')}</p><h3>训练</h3><p><b>豁免：</b>${uniq([backgroundSave(),school?.save]).join('、')}<br><b>技能：</b>${allSkills().join('、')}<br><b>武器：</b>${allWeapons().join('、')}<br><b>护甲：</b>${school?.armor.join('、')||'无'}<br><b>工具与语言：</b>${allToolsLanguages().join('、')}</p></div>
  <div class="sheet-block"><h3>学派数据</h3><p><b>初始学派：</b>${school?.name||'—'}<br><b>当前主学派：</b>${mainSchool()?.name||'—'}<br><b>生命骰：</b>${school?`d${school.hitDie}`:'—'}<br><b>初始器具：</b>${school?.implements||'—'}</p>${learnedSchoolIds().map(id=>{const s=schoolById(id);return `<p><b>${s.name}（${nodeSpentFor(id)} OP）</b><br>关键属性 ${s.key}；攻击 ${signed(schoolAttack(id))}；豁免 DC ${schoolDC(id)}</p>`}).join('')}<h3>节点</h3>${learnedSchoolIds().map(id=>`<p><b>${schoolById(id).name}</b></p><ul>${selectedNodeObjects(id).map(n=>`<li>${n.id} · ${n.name}（${n.cost??'待定'} OP）</li>`).join('')}</ul>`).join('')||'<ul><li>尚未记录</li></ul>'}</div>
  <div class="sheet-block"><h3>装备</h3><p><b>武器：</b>${weapon?`${weapon.name}，${weapon.damage} ${weapon.type}；${weapon.tagsText}`:'—'}<br><b>护甲：</b>${ARMORS.find(a=>a.id===state.armor)?.name||'不穿甲'}${state.shield?'，盾牌':''}<br><b>装备包：</b>${state.pack||'—'}<br><b>资金：</b>${state.money||'—'} / ${state.gold||0} 金币<br><b>其他：</b>${esc(state.equipmentNotes||'—')}</p></div>
  <div class="sheet-block"><h3>背景特性</h3><p><b>${esc(bg?.feature||'—')}：</b>${esc(bg?.featureText||'')}</p><h3>成长选择</h3><ul>${rewards.length?rewards.map(r=>`<li>${r.type==='feat'?FEATS.find(f=>f.id===r.feat)?.name||'未选专长':r.type==='asi2'?`${r.attr1||'未选'} +2`:r.type==='asi11'?`${r.attr1||'未选'}、${r.attr2||'未选'}各 +1`:'未完成'}</li>`).join(''):'<li>当前 OP 尚无成长选择</li>'}</ul></div></div></div>`;
}
function renderFinish(){
  const issues=allIssues(),pct=completion(),checks=issues.length?issues.map(i=>({ok:false,text:`${STEPS[i.step].nav}：${i.text}`})):[{ok:true,text:"所有必填项目与规则校验均已通过"}];
  return `<div class="finish-hero"><div><h2>${issues.length?'角色轮廓已经完成':'可以上桌了'}</h2><p>${issues.length?`还有 ${issues.length} 项需要确认。你可以直接点击左侧步骤返回修正；工具不会清除已经填写的内容。`:'属性、背景、初始学派、节点、熟练、装备与成长选择已经通过自动检查。建议开团前再让主持人确认自创内容与时代装备。'}</p><div class="export-actions"><button class="primary-button" data-action="print">打印／存为 PDF</button><button class="ghost-button" data-action="downloadJson">导出存档</button><button class="ghost-button" data-action="downloadHtml">导出独立角色卡</button><button class="ghost-button" data-action="importJson">读取存档</button><input id="importFile" type="file" accept="application/json" hidden></div></div><div class="completion-ring" style="--progress:${pct}%"><b>${pct}%</b></div></div>
  <div style="margin-top:15px">${checkList(checks)}</div>${fullSheet()}`;
}

function renderPreview(){
  const stats=finalStats(),school=currentSchool(),bg=currentBackground(),weapon=selectedWeaponData();
  $("#sheetPreview").innerHTML=`<div class="preview-identity">${tokenMarkup("token-avatar-preview")}<div><span class="eyebrow">LIVE SHEET</span><h2>${esc(state.name||"未命名角色")}</h2><p class="preview-subtitle">${esc(state.concept||"你的角色轮廓会在这里逐渐成形。")}</p></div></div>
  <div class="preview-stat">${ATTRIBUTES.map(a=>`<div><b>${stats[a]}</b><small>${a} ${signed(mod(stats[a]))}</small></div>`).join("")}</div>
  <div class="preview-core"><div><b>${hpMax()||'—'}</b><small>生命</small></div><div><b>${armorClass()}</b><small>AC</small></div><div><b>${signed(mod(stats.敏捷))}</b><small>先攻</small></div><div><b>${signed(profBonus())}</b><small>熟练</small></div></div>
  <div class="preview-section"><h3>Identity</h3><div class="preview-line"><span>来处</span><b>${state.origin==='inner'?'门内人':'门外人'}</b></div><div class="preview-line"><span>背景</span><b>${esc(bg?.name||'未选择')}</b></div><div class="preview-line"><span>学派</span><b>${esc(school?.name||'未选择')}</b></div><div class="preview-line"><span>总 OP</span><b>${state.totalOP}</b></div></div>
  ${school?`<div class="preview-section"><h3>Schools</h3><div class="preview-line"><span>主学派</span><b>${mainSchool()?.name||school.name}</b></div><div class="preview-line"><span>兼修</span><b>${Math.max(0,learnedSchoolIds().length-1)} 门</b></div><div class="preview-line"><span>节点</span><b>${selectedNodeObjects().length} 个 · ${nodeSpent()} OP</b></div></div>`:''}
  <div class="preview-section"><h3>Proficiencies</h3><div class="preview-pills">${allSkills().length?allSkills().map(x=>`<span>${x} ${signed(skillBonus(x))}</span>`).join(''):'<span>尚未选择技能</span>'}</div></div>
  ${weapon?`<div class="preview-section"><h3>Weapon</h3><div class="preview-line"><span>${weapon.name}</span><b>${weapon.damage} ${weapon.type}</b></div></div>`:''}`;
}

function render(){
  renderNav();$("#pageTitle").textContent=STEPS[state.step].title;
  const renderers=[renderConcept,renderStats,renderBackground,renderSchool,renderNodes,renderProficiencies,renderEquipment,renderFeats,renderFinish];
  $("#stepContent").innerHTML=renderers[state.step]();$("#backButton").disabled=state.step===0;$("#nextButton").textContent=state.step===STEPS.length-1?"回到开头":"继续";
  $("#stepCounter").textContent=`第 ${state.step+1} 步，共 ${STEPS.length} 步`;$("#progressFill").style.width=`${(state.step+1)/STEPS.length*100}%`;
  renderPreview();saveState();window.scrollTo({top:0,behavior:"smooth"});
}

function resetDependentFromBackground(){state.backgroundSkills=[];state.backgroundTool="";state.backgroundWeapon="";state.bgBonuses=Object.fromEntries(ATTRIBUTES.map(a=>[a,0]));}
function cascadeRemoveNode(id,schoolId=state.activeSchoolId){const school=schoolById(schoolId),selected=nodesFor(schoolId),remove=new Set([id]);let changed=true;while(changed){changed=false;school.nodes.forEach(n=>{if(selected.includes(n.id)&&n.pre.some(p=>remove.has(p))&&!remove.has(n.id)){remove.add(n.id);changed=true}if(n.pre.includes('ALL')&&remove.size&&!remove.has(n.id)){remove.add(n.id);changed=true}})}state.schoolNodes[schoolId]=selected.filter(x=>!remove.has(x));}
function autoFillNodes(){const school=activeSchool();if(!school)return;let changed=true;while(changed){changed=false;for(const n of school.nodes){if(!nodesFor(school.id).includes(n.id)&&canSelectNode(n,school.id)){state.schoolNodes[school.id].push(n.id);changed=true;if(nodeSpent()>=state.totalOP)break;}}}render();}
function applyRecommendedStats(){const order=[currentSchool()?.key||"智力","体质","敏捷","知性","灵恩","力量"],unique=uniq(order);ATTRIBUTES.forEach(a=>{if(!unique.includes(a))unique.push(a)});const values=[15,14,13,12,10,8];state.stats=Object.fromEntries(unique.map((a,i)=>[a,values[i]]));render();}
function roll(sides,count){let sum=0;for(let i=0;i<count;i++)sum+=1+Math.floor(Math.random()*sides);return sum;}
function filename(){return (state.name.trim()||"未命名角色").replace(/[\\/:*?"<>|]/g,"-");}
function download(name,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportData(){return {...state,derived:{finalStats:finalStats(),hp:hpMax(),ac:armorClass(),initiative:mod(finalStats().敏捷),proficiency:profBonus(),initialSchool:currentSchool()?.name,mainSchool:mainSchool()?.name,schoolValues:Object.fromEntries(learnedSchoolIds().map(id=>[id,{op:nodeSpentFor(id),attack:schoolAttack(id),dc:schoolDC(id)}])),saves:uniq([backgroundSave(),currentSchool()?.save]),skills:Object.fromEntries(ALL_SKILLS.map(s=>[s,skillBonus(s)]))}};}
function processTokenFile(file){
  if(!["image/png","image/jpeg","image/webp"].includes(file?.type)){toast("请选择 PNG、JPG 或 WebP 图片");return;}
  if(file.size>12*1024*1024){toast("图片不能超过 12 MB");return;}
  const reader=new FileReader();
  reader.onload=()=>{const image=new Image();image.onload=()=>{const size=512,canvas=document.createElement("canvas"),ctx=canvas.getContext("2d"),side=Math.min(image.naturalWidth,image.naturalHeight),sx=(image.naturalWidth-side)/2,sy=(image.naturalHeight-side)/2;canvas.width=size;canvas.height=size;ctx.drawImage(image,sx,sy,side,side,0,0,size,size);state.tokenImage=canvas.toDataURL("image/webp",.84);render();toast("角色形象已加入");};image.onerror=()=>toast("无法读取这张图片");image.src=reader.result;};
  reader.onerror=()=>toast("无法读取这张图片");reader.readAsDataURL(file);
}

document.addEventListener("click",event=>{
  const el=event.target.closest("[data-action]");if(!el)return;const action=el.dataset.action,value=el.dataset.value;
  if(action==="goto"){state.step=+value;render();return;}
  if(action==="removeToken"){state.tokenImage="";render();toast("角色形象已移除");return;}
  if(action==="origin"){state.origin=value;state.backgroundId="";resetDependentFromBackground();render();return;}
  if(action==="role"){state.role=state.role===value?"":value;render();return;}
  if(action==="statUp"&&state.stats[value]<15){state.stats[value]++;render();return;}
  if(action==="statDown"&&state.stats[value]>8){state.stats[value]--;render();return;}
  if(action==="recommendedStats"){applyRecommendedStats();return;}if(action==="resetStats"){ATTRIBUTES.forEach(a=>state.stats[a]=8);render();return;}
  if(action==="background"){state.backgroundId=value;resetDependentFromBackground();render();return;}
  if(action==="backgroundSkill"){const arr=state.backgroundSkills,ix=arr.indexOf(value);if(ix>=0)arr.splice(ix,1);else if(arr.length<2)arr.push(value);render();return;}
  if(action==="bonusUp"&&backgroundBonusTotal()<2&&state.stats[value]+state.bgBonuses[value]<17){state.bgBonuses[value]++;render();return;}
  if(action==="bonusDown"&&state.bgBonuses[value]>0){state.bgBonuses[value]--;render();return;}
  if(action.startsWith("custom")){const map={customAttr:["attrs",3],customSkill:["skills",4],customWeapon:["weapons",3]},[prop,limit]=map[action],arr=state.customBackground[prop],ix=arr.indexOf(value);if(ix>=0)arr.splice(ix,1);else if(arr.length<limit)arr.push(value);resetDependentFromBackground();render();return;}
  if(action==="school"){state.schoolId=value;state.schoolNodes={[value]:["基石"]};state.schoolOrder=[value];state.activeSchoolId=value;state.schoolSkills=[];state.schoolLanguage="";state.weapon="";state.armor="none";state.shield=false;render();return;}
  if(action==="activeSchool"){state.activeSchoolId=value;render();return;}
  if(action==="addSchool"){const conflict=candidateConflict(value);if(conflict?.type==='heavy'){toast("该学派与已掌握学派存在重度冲突");return;}state.schoolOrder.push(value);state.schoolNodes[value]=[];state.activeSchoolId=value;render();return;}
  if(action==="removeSchool"){const s=schoolById(value);if(nodeSpentFor(value)>0&&!confirm(`确定移除${s.name}及其全部已选节点吗？`))return;delete state.schoolNodes[value];state.schoolOrder=state.schoolOrder.filter(id=>id!==value);if(state.activeSchoolId===value)state.activeSchoolId=state.schoolId;render();return;}
  if(action==="node"){const sid=el.dataset.school||state.activeSchoolId,selected=nodesFor(sid).includes(value);if(selected)cascadeRemoveNode(value,sid);else state.schoolNodes[sid].push(value);render();return;}
  if(action==="autoNodes"){autoFillNodes();return;}
  if(action==="schoolSkill"){const arr=state.schoolSkills,ix=arr.indexOf(value);if(ix>=0)arr.splice(ix,1);else if(arr.length<2&&!state.backgroundSkills.includes(value))arr.push(value);render();return;}
  if(action==="schoolLanguage"){state.schoolLanguage=state.schoolLanguage===value?"":value;render();return;}
  if(action==="weapon"){state.weapon=value;render();return;}if(action==="pack"){state.pack=value;render();return;}
  if(action==="rollFunds"){if(state.origin==='outer'){state.money=String(roll(6,4)*100-(state.guideFee?50:0));state.gold=String(state.guideFee?1:0)}else{state.money=String(roll(6,3)*10);state.gold=String(roll(4,1))}render();toast("起始资金已经掷出");return;}
  if(action==="guideFee"){state.guideFee=!state.guideFee;if(state.money){state.money=String(Math.max(0,+state.money+(state.guideFee?-50:50)));state.gold=String(Math.max(0,+state.gold+(state.guideFee?1:-1)))}render();return;}
  if(action==="featFilter"){state.featFilter=value;render();return;}
  if(action==="feat"){const found=state.rewards.find(r=>r.type==='feat'&&r.feat===value);if(found){found.feat=""}else{const slot=state.rewards.find(r=>r.type==='feat'&&!r.feat)||state.rewards.find(r=>!r.type);if(slot){slot.type='feat';slot.feat=value}else{toast("成长栏位已满")}}render();return;}
  if(action==="print"){window.print();return;}if(action==="downloadJson"){download(`${filename()}-角色存档.json`,JSON.stringify(exportData(),null,2),"application/json;charset=utf-8");return;}
  if(action==="downloadHtml"){const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(state.name)}的角色卡</title><style>body{font-family:"Microsoft YaHei",sans-serif;max-width:900px;margin:40px auto;padding:0 24px;color:#222}.sheet-full{border:1px solid #999;padding:24px}.sheet-full-head,.summary-strip,.preview-stat,.sheet-columns{display:grid;gap:12px}.sheet-full-head{grid-template-columns:1fr auto;border-bottom:1px solid #bbb;padding-bottom:12px}.sheet-identity{display:flex;align-items:center;gap:14px}.token-avatar{width:70px;height:70px;border:1px solid #999;border-radius:50%;overflow:hidden;display:grid;place-items:center;flex:0 0 auto}.token-avatar img{width:100%;height:100%;object-fit:cover}.summary-strip{grid-template-columns:repeat(4,1fr);margin-top:14px}.preview-stat{grid-template-columns:repeat(6,1fr);margin:14px 0}.sheet-columns{grid-template-columns:1fr 1fr}.summary-box,.preview-stat>div{border:1px solid #bbb;padding:10px;text-align:center}.summary-box small,.summary-box b,.preview-stat b,.preview-stat small{display:block}h2{margin:0}.eyebrow{font-size:10px;letter-spacing:.15em;color:#80602c}.sheet-block{font-size:13px;line-height:1.65}.sheet-block h3{color:#80602c}.tag{border:1px solid #aaa;border-radius:99px;padding:2px 6px}@media print{body{margin:0}.sheet-full{border:0}}</style><body>${fullSheet()}</body></html>`;download(`${filename()}-角色卡.html`,html,"text/html;charset=utf-8");return;}
  if(action==="importJson"){$("#importFile").click();return;}
});

document.addEventListener("input",event=>{
  const el=event.target;
  if(el.dataset.bind){state[el.dataset.bind]=el.value;saveState();renderPreview();}
  if(el.dataset.custom){const key=el.dataset.custom;if(key==='tool')state.customBackground.tools=[el.value];else state.customBackground[key]=el.value;saveState();}
});
document.addEventListener("change",event=>{
  const el=event.target;
  if(el.id==="tokenFile"&&el.files[0]){processTokenFile(el.files[0]);return;}
  if(el.dataset.custom){render();return;}
  if(el.dataset.select){const key=el.dataset.select;if(key==='totalOP'){state.totalOP=Math.max(1,Math.min(30,+el.value||1));normalizedRewards();}else if(key==='shield')state.shield=el.value==='true';else state[key]=el.value;render();return;}
  if(el.dataset.customSelect){state.customBackground.saves[el.dataset.customSelect==='save0'?0:1]=el.value;resetDependentFromBackground();render();return;}
  if(el.dataset.reward){const i=+el.dataset.index,r=state.rewards[i],key=el.dataset.reward;r[key]=el.value;if(key==='type'){r.feat="";r.attr1="";r.attr2=""}render();return;}
  if(el.id==="importFile"&&el.files[0]){const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(reader.result);if(parsed.version!==1)throw new Error();const base=freshState();state={...base,...parsed,stats:{...base.stats,...parsed.stats},bgBonuses:{...base.bgBonuses,...parsed.bgBonuses},customBackground:{...base.customBackground,...parsed.customBackground},schoolNodes:{...(parsed.schoolNodes||{})}};state.tokenImage=safeTokenImage(state.tokenImage);if(state.schoolId){if(!state.schoolOrder?.length)state.schoolOrder=[state.schoolId];if(!state.schoolNodes[state.schoolId])state.schoolNodes[state.schoolId]=Array.isArray(parsed.nodes)&&parsed.nodes.length?parsed.nodes:["基石"];if(!state.activeSchoolId)state.activeSchoolId=state.schoolId}saveState();render();toast("角色存档已读取")}catch{toast("无法读取这个存档文件")}};reader.readAsText(el.files[0]);}
});

$("#backButton").addEventListener("click",()=>{if(state.step>0){state.step--;render();}});
$("#nextButton").addEventListener("click",()=>{if(state.step===STEPS.length-1){state.step=0;render();return;}const issues=stepIssues(state.step);if(issues.length){toast(issues[0]);return;}state.step++;state.maxStep=Math.max(state.maxStep,state.step);render();});
$("#resetButton").addEventListener("click",()=>{if(confirm("确定清空当前角色并重新开始吗？导出的存档不会受影响。")){state=freshState();saveState();render();}});

render();
