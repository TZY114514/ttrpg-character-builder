(function(){
  "use strict";
  const LIBRARY_KEY="occultism-character-library-v1";
  const DRAFT_KEY="guided-character-builder-v1";
  const now=()=>new Date().toISOString();
  const number=(value,fallback=0)=>Number.isFinite(+value)?+value:fallback;
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,number(value,min)));
  const id=()=>globalThis.crypto?.randomUUID?.()||`char-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const clone=value=>JSON.parse(JSON.stringify(value));

  function load(){
    try{
      const parsed=JSON.parse(localStorage.getItem(LIBRARY_KEY));
      return parsed?.version===1&&Array.isArray(parsed.characters)?parsed:{version:1,characters:[]};
    }catch{return {version:1,characters:[]};}
  }
  function save(library){
    localStorage.setItem(LIBRARY_KEY,JSON.stringify(library));
    return library;
  }
  function initialInventory(build){
    const entries=[];
    if(build.weapon)entries.push({id:id(),name:build.weapon,qty:1,weight:0,equipped:true,notes:"主武器"});
    if(build.pack)entries.push({id:id(),name:build.pack,qty:1,weight:0,equipped:false,notes:"初始装备包"});
    const school=typeof SCHOOLS!=="undefined"?SCHOOLS.find(entry=>entry.id===build.schoolId):null;
    if(school?.implements)entries.push({id:id(),name:school.implements,qty:1,weight:0,equipped:false,notes:"初始学派器具"});
    return entries;
  }
  function initialPlay(build){
    const maxHp=Math.max(1,number(build.derived?.hp,1));
    const rank=Math.max(1,number(build.totalOP,1));
    return {
      currentHp:maxHp,tempHp:0,maxHp,hitDice:rank,maxHitDice:rank,inspiration:0,
      deathSuccess:0,deathFailure:0,exhaustion:0,conditions:[],
      currency:{money:Math.max(0,number(build.money,0)),gold:Math.max(0,number(build.gold,0)),silver:0,copper:0},
      resources:[
        {id:id(),name:"生命骰",current:rank,max:rank,recharge:"long",notes:`d${(typeof SCHOOLS!=="undefined"?SCHOOLS.find(entry=>entry.id===build.schoolId)?.hitDie:8)||8}`},
        {id:id(),name:"灵感",current:0,max:1,recharge:"none",notes:"主持人授予"}
      ],
      inventory:initialInventory(build),notes:"",sessionLog:[]
    };
  }
  function normalizePlay(play,build){
    const base=initialPlay(build),value={...base,...(play||{})};
    value.maxHp=Math.max(1,number(build.derived?.hp,value.maxHp));
    value.currentHp=clamp(value.currentHp,0,value.maxHp);
    value.tempHp=Math.max(0,number(value.tempHp));
    value.maxHitDice=Math.max(1,number(build.totalOP,value.maxHitDice));
    value.hitDice=clamp(value.hitDice,0,value.maxHitDice);
    value.deathSuccess=clamp(value.deathSuccess,0,3);
    value.deathFailure=clamp(value.deathFailure,0,3);
    value.exhaustion=clamp(value.exhaustion,0,6);
    value.conditions=Array.isArray(value.conditions)?value.conditions:[];
    value.resources=Array.isArray(value.resources)?value.resources:[];
    value.inventory=Array.isArray(value.inventory)?value.inventory:[];
    value.sessionLog=Array.isArray(value.sessionLog)?value.sessionLog.slice(0,40):[];
    value.currency={...base.currency,...(value.currency||{})};
    return value;
  }
  function list(){return load().characters.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));}
  function get(characterId){return load().characters.find(character=>character.id===characterId)||null;}
  function upsertBuild(build,characterId=""){
    const library=load(),index=library.characters.findIndex(character=>character.id===characterId),stamp=now();
    if(index>=0){
      const old=library.characters[index],oldMax=number(old.play?.maxHp,build.derived?.hp),wasFull=number(old.play?.currentHp)===oldMax;
      const oldDiceMax=number(old.play?.maxHitDice,old.build?.totalOP||1),newDiceMax=Math.max(1,number(build.totalOP,1));
      const play=normalizePlay(old.play,build);
      if(wasFull)play.currentHp=play.maxHp;
      play.hitDice=Math.min(newDiceMax,number(play.hitDice)+Math.max(0,newDiceMax-oldDiceMax));
      play.maxHitDice=newDiceMax;
      const lifeDice=play.resources.find(resource=>resource.name==="生命骰");
      if(lifeDice){lifeDice.max=newDiceMax;lifeDice.current=play.hitDice;}
      play.sessionLog.unshift({id:id(),at:stamp,text:`角色成长更新：总 OP ${old.build?.totalOP||"—"} → ${build.totalOP}`});
      library.characters[index]={...old,name:build.name||"未命名角色",updatedAt:stamp,build:clone(build),play};
      save(library);return library.characters[index];
    }
    const character={id:id(),name:build.name||"未命名角色",createdAt:stamp,updatedAt:stamp,build:clone(build),play:initialPlay(build)};
    character.play.sessionLog.push({id:id(),at:stamp,text:"角色档案建立"});
    library.characters.push(character);save(library);return character;
  }
  function update(characterId,mutator,logText=""){
    const library=load(),index=library.characters.findIndex(character=>character.id===characterId);
    if(index<0)return null;
    const character=library.characters[index],draft=clone(character);
    mutator(draft.play,draft);
    draft.play=normalizePlay(draft.play,draft.build);
    draft.updatedAt=now();
    if(logText)draft.play.sessionLog.unshift({id:id(),at:draft.updatedAt,text:logText});
    draft.play.sessionLog=draft.play.sessionLog.slice(0,40);
    library.characters[index]=draft;save(library);return draft;
  }
  function remove(characterId){const library=load();library.characters=library.characters.filter(character=>character.id!==characterId);save(library);}
  function beginUpgrade(characterId,totalOP){
    const character=get(characterId);if(!character)return false;
    const draft=clone(character.build);delete draft.derived;
    draft.libraryId=character.id;draft.totalOP=Math.max(1,Math.min(30,number(totalOP,draft.totalOP||1)));
    draft.step=4;draft.maxStep=Math.max(8,number(draft.maxStep));
    localStorage.setItem(DRAFT_KEY,JSON.stringify(draft));return true;
  }
  function newDraft(){localStorage.removeItem(DRAFT_KEY);}
  function exportLibrary(){return JSON.stringify(load(),null,2);}
  function importPayload(payload){
    const parsed=typeof payload==="string"?JSON.parse(payload):payload;
    if(parsed?.version===1&&Array.isArray(parsed.characters)){
      const library=load(),byId=new Map(library.characters.map(character=>[character.id,character]));
      parsed.characters.forEach(character=>{if(character?.id&&character?.build)byId.set(character.id,{...character,play:normalizePlay(character.play,character.build)});});
      library.characters=[...byId.values()];save(library);return library.characters.length;
    }
    if(parsed?.version===1&&parsed?.name){upsertBuild(parsed,parsed.libraryId||"");return 1;}
    throw new Error("unsupported payload");
  }
  globalThis.CharacterStore={LIBRARY_KEY,DRAFT_KEY,list,get,upsertBuild,update,remove,beginUpgrade,newDraft,exportLibrary,importPayload,id};
})();
