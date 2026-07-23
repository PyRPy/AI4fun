/* ============================================================
   PlayBridge Brain — brain.js
   Level: I0 (simplified SAYC bidding + rule-based play heuristics)
   ------------------------------------------------------------
   THE BRAIN CONTRACT (api version 1)

   A brain is a global object named `Brain`:
     Brain = {
       name    : string,          // shown in logs/tests
       version : 'x.y.z',
       api     : 1,               // interface version — do not change
       evaluate(hand)                 -> {hcp, dist, pts, len[4], suitHCP[4], balanced}
       suggestBid(hand, auction, seat) -> {t:'pass'|'bid'|'x'|'xx', lvl?, st?, reason}
       choosePlay(G, seat)             -> {card:{s,r}, reason}
     }
   - hand: array of {s:0..3 (C,D,H,S), r:2..14}
   - auction: array of {t, lvl, st, seat}; seat: 0=N,1=E,2=S,3=W
   - G: game state {hands, trick, contract, declarer, auction}
   - Every result MUST be legal; bridge.html keeps a Pass/legality
     safety net, but relying on it is a brain bug.
   - `reason` strings power the hint system — always explain.

   SHARED RULES (defined in bridge.html, same global scope; loaded
   before any Brain function is called): SEATS, SUITS, STRAINS, RK,
   partner(s), side(s), ofSuit(hand,s), validCards(hand,ledSuit),
   trickWinner(trick,trump), lastBid(a), bidVal(c),
   cheapestLevel(a,st), legalInfo(a,seat), lastSuitBidBy(a,seat).

   HOW TO UPGRADE THE BRAIN (I1 conventions, I2 Monte Carlo, ...):
   1. Copy this file, implement the same contract, bump version.
   2. Replace brain.js next to bridge.html (or load both files and
      call setBrain(newBrain) from the console/UI).
   3. Verify: open bridge.html#test — all fixtures must pass —
      then run the headless smoke deals (see AGENTS.md).
   ============================================================ */

/* ---------- Hand evaluation (Level 1: HCP + distribution) ---------- */
function evalHand(hand){
  var len=[0,0,0,0],suitHCP=[0,0,0,0],hcp=0,i,c,v;
  for(i=0;i<hand.length;i++){
    c=hand[i];len[c.s]++;
    v=c.r===14?4:c.r===13?3:c.r===12?2:c.r===11?1:0;
    suitHCP[c.s]+=v;hcp+=v;
  }
  var dist=0;
  for(i=0;i<4;i++)dist+=len[i]===0?3:len[i]===1?2:len[i]===2?1:0;
  var ls=len.slice().sort(function(a,b){return b-a});
  var balanced=(ls[0]===4&&ls[1]===3)||(ls[0]===4&&ls[1]===4)||(ls[0]===5&&ls[1]===3&&ls[2]===3);
  return {hcp:hcp,dist:dist,pts:hcp+dist,len:len,suitHCP:suitHCP,balanced:balanced};
}
/* ---------- Bidding AI: simplified SAYC (Level 2) ---------- */
/* Hooks for future conventions (I1): */
var Conventions={
  stayman:function(){return null},   // TODO I1
  jacobyTransfer:function(){return null}, // TODO I1
  blackwood:function(){return null}   // TODO I1
};
function bestSuit(ev,majorsOnly,minLen){
  var order=[3,2,1,0],best=-1,bl=minLen-1,i,s;
  for(i=0;i<4;i++){
    s=order[i];
    if(majorsOnly&&s<2)continue;
    if(ev.len[s]>bl||(ev.len[s]===bl&&best>=0&&s>best&&ev.len[s]===ev.len[best])){best=s;bl=ev.len[s];}
  }
  return best>=0?best:null;
}
function gameLevel(st){return st===4?3:st>=2?4:5} // 3NT / 4 of major / 5 of minor
function mkBid(auction,st,lvlWanted,reason){
  var lvl=cheapestLevel(auction,st);
  if(lvl===null)return null;
  if(lvlWanted){
    if(lvlWanted>7||lvl>lvlWanted)return null; // must be exactly this level; never climb past it
    lvl=lvlWanted;
  }
  return {t:'bid',lvl:lvl,st:st,reason:reason};
}
function suggestBid(hand,auction,seat){
  var ev=evalHand(hand),pts=ev.pts,h=ev.hcp,i,c;
  function pass(r){return {t:'pass',reason:r}}
  var myBids=[],pBids=[],oppBids=[];
  for(i=0;i<auction.length;i++){
    c=auction[i];
    if(c.t!=='bid')continue;
    if(c.seat===seat)myBids.push(c);
    else if(c.seat===partner(seat))pBids.push(c);
    else oppBids.push(c);
  }
  var b,p,firstBid=null;
  for(i=0;i<auction.length;i++)if(auction[i].t==='bid'){firstBid=auction[i];break;}
  /* --- OPENING (no one has bid) --- */
  if(myBids.length===0&&pBids.length===0&&oppBids.length===0){
    if(pts<12)return pass('Fewer than 12 points — not enough to open');
    if(h>=22)return mkBid(auction,0,2,'22+ points — strong 2'+STRAINS[0])||pass('Fallback');
    if(h>=15&&h<=17&&ev.balanced)return mkBid(auction,4,1,'15–17 HCP, balanced — open 1NT');
    if(h>=20&&h<=21&&ev.balanced)return mkBid(auction,4,2,'20–21 HCP, balanced — open 2NT');
    var s5=bestSuit(ev,true,5);
    if(s5!==null)return mkBid(auction,s5,1,pts+' pts, '+ev.len[s5]+'-card major — open 1'+STRAINS[s5]);
    var sm=bestSuit(ev,false,3);
    if(ev.len[0]===3&&ev.len[1]===3)sm=0; // SAYC: 3-3 minors open 1 club
    if(sm!==null)return mkBid(auction,sm,1,pts+' pts, longest suit — open 1'+STRAINS[sm]);
    return pass('No biddable suit — fallback pass');
  }
  /* --- OVERCALL (opponents bid, partner silent) --- */
  if(myBids.length===0&&pBids.length===0&&oppBids.length>0){
    if(pts>=10){
      var so=bestSuit(ev,false,5);
      if(so!==null&&ev.suitHCP[so]>=3){
        var lo=cheapestLevel(auction,so);
        if(lo!==null&&lo<=2)return mkBid(auction,so,lo,'Overcall: '+pts+' pts, good '+ev.len[so]+'-card suit');
      }
    }
    return pass('No sound overcall (need 10+ pts and a good 5-card suit)');
  }
  /* --- RESPONDING to partner's opening --- */
  if(myBids.length===0&&pBids.length>0){
    p=pBids[pBids.length-1];
    // partner opened 2C (strong, opening bid only)
    if(p.lvl===2&&p.st===0&&firstBid===p){
      if(pts>=8){
        var sp=bestSuit(ev,false,5),mp;
        if(sp!==null){mp=mkBid(auction,sp,null,'8+ pts — positive response');if(mp)return mp;}
        mp=mkBid(auction,4,null,'8+ pts — positive NT');if(mp)return mp;
        return pass('Fallback — no legal positive');
      }
      return mkBid(auction,1,null,'0–7 pts — 2'+STRAINS[1]+' waiting')||pass('Fallback');
    }
    // partner opened NT
    if(p.st===4){
      if(p.lvl===1){
        if(pts<=7)return pass('0–7 pts opposite 1NT — pass');
        var mbn;
        if(pts<=9){mbn=mkBid(auction,4,2,'8–9 pts — invite game with 2NT');if(mbn)return mbn;}
        else{mbn=mkBid(auction,4,3,'10+ pts opposite 15–17 — bid 3NT');if(mbn)return mbn;}
        return pass('No legal NT call — fallback pass');
      }
      if(p.lvl===2){
        if(pts>=4){var mb2=mkBid(auction,4,3,'4+ pts opposite 20–21 — bid 3NT');if(mb2)return mb2;}
        return pass('0–3 pts — pass');
      }
    }
    // partner opened a suit
    var sup=ev.len[p.st],maj=p.st>=2,lvl;
    if(pts<6)return pass('Fewer than 6 points — pass');
    if(pts<=9){
      if(sup>=3&&cheapestLevel(auction,p.st)===p.lvl+1)
        return mkBid(auction,p.st,p.lvl+1,'6–9 pts, '+sup+'-card support — raise partner');
      lvl=cheapestLevel(auction,4);
      if(lvl!==null&&lvl<=2)return mkBid(auction,4,lvl,'6–9 pts, no fit — '+lvl+'NT');
      return pass('Too weak to advance — fallback pass');
    }
    // 10+
    if(maj&&sup>=3){
      if(pts>=13){
        var mg=mkBid(auction,p.st,4,'13+ pts with support — bid game');
        if(mg)return mg;
        return pass('Game out of reach — fallback pass');
      }
      return mkBid(auction,p.st,p.lvl+1,'10–12 pts, support — raise')||pass('Fallback');
    }
    var sn=-1,sl=3;
    for(i=3;i>=0;i--)if(i!==p.st&&ev.len[i]>sl){sn=i;sl=ev.len[i];}
    if(sn>=0){
      lvl=cheapestLevel(auction,sn);
      if(lvl!==null&&lvl<=2)return mkBid(auction,sn,lvl,'10+ pts — bid new suit '+STRAINS[sn]);
    }
    lvl=cheapestLevel(auction,4);
    if(lvl!==null&&lvl<=3&&ev.balanced)return mkBid(auction,4,lvl,'10+ pts, balanced — '+lvl+'NT');
    if(sup>=3)return mkBid(auction,p.st,p.lvl+1,'Support — raise partner')||pass('Fallback');
    return pass('No good advance — fallback pass');
  }
  /* --- REBID (I have bid before) --- */
  if(myBids.length>0){
    var my0=myBids[0];
    // after my strong 2C opening (opening bid only, not an overcall)
    if(my0.lvl===2&&my0.st===0&&firstBid===my0){
      var pb=pBids[pBids.length-1],mb;
      if(pb&&pb.st<4&&!(pb.lvl===2&&pb.st===1)&&ev.len[pb.st]>=4&&pb.lvl<gameLevel(pb.st)){
        mb=mkBid(auction,pb.st,pb.lvl+1,'Strong — raise partner’s positive');
        if(mb)return mb;
      }
      if(ev.balanced){
        mb=mkBid(auction,4,h>=25?3:null,h>=25?'25+ HCP balanced — 3NT':'22–24 balanced — NT');
        if(mb)return mb;
      }
      var ss=bestSuit(ev,false,5);
      if(ss!==null){mb=mkBid(auction,ss,null,'Strong hand — show '+STRAINS[ss]);if(mb)return mb;}
      mb=mkBid(auction,4,3,'Strong hand — 3NT');if(mb)return mb;
      return pass('Fallback');
    }
    p=pBids.length?pBids[pBids.length-1]:null;
    if(!p)return pass('Partner silent — fallback pass');
    // partner raised my suit
    if(p.st===my0.st&&p.st<4){
      if(p.st>=2){ // major
        if(pts>=17){var mag=mkBid(auction,p.st,4,'17+ pts — accept game');if(mag)return mag;}
        if(pts>=15&&p.lvl===2){var mi=mkBid(auction,p.st,3,'15–16 pts — invite game');if(mi)return mi;}
        return pass('Minimum opener — pass');
      }
      if(ev.balanced&&h>=15){var m3n=mkBid(auction,4,3,'Minor fit, 15+ balanced — try 3NT');if(m3n)return m3n;}
      return pass('Minimum opener — pass');
    }
    // partner bid NT
    if(p.st===4){
      if(p.lvl===2&&my0.st===4&&my0.lvl===1){
        if(h>=16){var ma=mkBid(auction,4,3,'16–17 HCP — accept game invite');if(ma)return ma;}
        return pass('15 HCP minimum — decline invite');
      }
      if(h>=18){var m3b=mkBid(auction,4,3,'18+ HCP — bid 3NT');if(m3b)return m3b;}
      return pass('No extra values — pass');
    }
    // partner bid a new suit
    if(ev.len[p.st]>=4){
      if(p.lvl>=gameLevel(p.st))return pass('Game already reached — pass');
      return mkBid(auction,p.st,p.lvl+1,'4-card support for partner — raise')||pass('Fallback');
    }
    if(ev.len[my0.st]>=6){
      var lr=cheapestLevel(auction,my0.st);
      if(lr!==null&&lr<=3)return mkBid(auction,my0.st,lr,'6-card suit — rebid it');
    }
    if(ev.balanced&&h>=15&&h<=17){
      var ln=cheapestLevel(auction,4);
      if(ln!==null&&ln<=2)return mkBid(auction,4,ln,'15–17 balanced — '+ln+'NT');
    }
    return pass('No clear rebid — fallback pass');
  }
  return pass('Fallback pass');
}
/* ---------- Play engine (rule-based heuristics, I0) ---------- */
function lowest(cards){var m=cards[0];for(var i=1;i<cards.length;i++)if(cards[i].r<m.r)m=cards[i];return m}
function highest(cards){var m=cards[0];for(var i=1;i<cards.length;i++)if(cards[i].r>m.r)m=cards[i];return m}
function minAbove(cards,rank){var best=null;for(var i=0;i<cards.length;i++)if(cards[i].r>rank&&(!best||cards[i].r<best.r))best=cards[i];return best}
function discardChoice(hand,trump){
  var ev=evalHand(hand),s,bestS=-1,bestLen=99,bestH=99;
  for(s=0;s<4;s++){
    if(s===trump||ev.len[s]===0)continue;
    if(ev.len[s]<bestLen||(ev.len[s]===bestLen&&ev.suitHCP[s]<bestH)){bestS=s;bestLen=ev.len[s];bestH=ev.suitHCP[s];}
  }
  return bestS<0?lowest(hand):lowest(ofSuit(hand,bestS));
}
function seqTop(cards){ // top of touching honors (2+ consecutive, top is an honor)
  var s=cards.slice().sort(function(a,b){return b.r-a.r});
  if(s.length>=2&&s[0].r>=11&&s[0].r-s[1].r===1)return s[0];
  return null;
}
function fourthBest(cards){
  var s=cards.slice().sort(function(a,b){return b.r-a.r});
  return s.length>=4?s[3]:s[s.length-1];
}
function choosePlay(G,seat){
  var hand=G.hands[seat],trick=G.trick,i,s,cards;
  var trump=(G.contract&&G.contract.st<4)?G.contract.st:null;
  var decl=G.declarer,declSide=(seat===decl||seat===partner(decl));
  var ledSuit=trick.length?trick[0].card.s:null;
  function ret(card,reason){return {card:card,reason:reason}}
  /* --- LEAD (first card of trick) --- */
  if(trick.length===0){
    if(!declSide){
      var ps=lastSuitBidBy(G.auction,partner(seat));
      if(ps!==null&&ofSuit(hand,ps).length){
        cards=ofSuit(hand,ps);
        var sq=seqTop(cards);
        return ret(sq||fourthBest(cards),sq?'Lead partner’s suit — top of touching honors':'Lead partner’s suit — fourth-best');
      }
      for(s=3;s>=0;s--){
        if(s===trump)continue;
        var sq2=seqTop(ofSuit(hand,s));
        if(sq2)return ret(sq2,'Top of touching honors');
      }
      var bs=-1,bl=0;
      for(s=0;s<4;s++){if(s===trump)continue;var l=ofSuit(hand,s).length;if(l>bl){bl=l;bs=s}}
      if(bs>=0)return ret(fourthBest(ofSuit(hand,bs)),'Fourth-best from longest suit');
      return ret(lowest(hand),'Only trumps left — lead low');
    }
    if(seat===decl&&trump!==null&&ofSuit(hand,trump).length>=2)
      return ret(highest(ofSuit(hand,trump)),'Draw trumps');
    for(s=3;s>=0;s--){
      cards=ofSuit(hand,s);
      for(i=0;i<cards.length;i++)if(cards[i].r===14)return ret(cards[i],'Cash winners (Ace)');
    }
    for(s=3;s>=0;s--){
      cards=ofSuit(hand,s);
      var hasA=false,k=null,j;
      for(j=0;j<cards.length;j++){if(cards[j].r===14)hasA=true;if(cards[j].r===13)k=cards[j];}
      if(hasA&&k)return ret(k,'Cash winners (King)');
    }
    var bs2=-1,bl2=0;
    for(s=0;s<4;s++){if(s===trump)continue;var l2=ofSuit(hand,s).length;if(l2>bl2){bl2=l2;bs2=s}}
    if(bs2>=0)return ret(fourthBest(ofSuit(hand,bs2)),'Develop long suit — fourth-best');
    return ret(lowest(hand),'Lead low');
  }
  /* --- FOLLOW --- */
  var valid=validCards(hand,ledSuit);
  var canFollow=ofSuit(hand,ledSuit).length>0;
  var win=trickWinner(trick,trump);
  var pWinning=(win.seat===partner(seat));
  if(!canFollow){
    if(!pWinning&&trump!==null){
      var tr=ofSuit(hand,trump);
      if(tr.length){
        var maxT=-1;
        for(i=0;i<trick.length;i++)if(trick[i].card.s===trump&&trick[i].card.r>maxT)maxT=trick[i].card.r;
        if(maxT<0)return ret(lowest(tr),'Ruff (trump in)');
        var ov=minAbove(tr,maxT);
        if(ov)return ret(ov,'Overruff');
      }
    }
    return ret(discardChoice(hand,trump),pWinning?'Partner winning — discard weakest suit':'Cannot win — discard weakest suit');
  }
  var pos=trick.length; // 1=second hand, 2=third, 3=fourth
  if(pos===1){
    var ledCard=trick[0].card;
    if(ledCard.r>=11){
      var cov=minAbove(valid,ledCard.r);
      if(cov)return ret(cov,'Cover an honor with an honor');
    }
    return ret(lowest(valid),'Second hand low');
  }
  if(pos===2){
    if(pWinning)return ret(lowest(valid),'Partner winning — play low');
    if(win.card.s===trump)return ret(lowest(valid),'Cannot beat the trump — play low');
    var third=minAbove(valid,win.card.r);
    if(third)return ret(third,'Third hand high');
    return ret(lowest(valid),'Cannot win — play low');
  }
  if(pWinning)return ret(lowest(valid),'Partner’s trick — win cheaply, play low');
  if(win.card.s===trump)return ret(lowest(valid),'Cannot beat the trump — play low');
  var fourth=minAbove(valid,win.card.r);
  if(fourth)return ret(fourth,'Win the trick — cheapest card');
  return ret(lowest(valid),'Cannot win — play low');
}
/* ---------- The Brain object (the swappable interface) ---------- */
var Brain={
  name:'SAYC I0',
  version:'1.0.0',
  api:1,
  evaluate:evalHand,
  suggestBid:suggestBid,
  choosePlay:choosePlay
};
