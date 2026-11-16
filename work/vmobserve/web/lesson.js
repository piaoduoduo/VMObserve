const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const verification=new URLSearchParams(location.search).get('verification')==='1';
const key='vmobserve-demand-worksheet-v1'+(verification?'-ui-test':'');
const answerOrigin=verification?'ui_verification':'learner_notes';
if(verification)document.querySelector('h1').textContent+='（页面验证，不是学习者作答）';
let config, report, identifier, job, notes={prediction:'',explanation:'',records:[]};
async function api(path,options){const r=await fetch(path,options);const data=await r.json();if(!r.ok)throw Error(data.error||r.statusText);return data;}
function persist(){notes.prediction=$('#prediction').value;notes.explanation=$('#explanation').value;notes.updated_at=new Date().toISOString();try{localStorage.setItem(key,JSON.stringify(notes));$('#save-status').textContent='草稿已保存在当前浏览器。';}catch(e){$('#save-status').textContent='浏览器保存不可用，请导出备份。';}}
function binding(){return report?{selected_record:identifier,run_id:report.run_id,report_sha256:report.original_report_sha256,source_sha256:report.sources,integrity:report.integrity.status,data_origin:report.data_origin,view_mode:report.view_mode}:null;}
async function select(id){report=null;identifier=id;$('#checks').innerHTML='';$('#observations').innerHTML='';$('#report-download').hidden=true;$('#provenance').textContent='正在核查原始证据…';try{
  const data=await api('/api/report?id='+encodeURIComponent(id));if(identifier!==id)return;report=data;
  const cases=report.cases.filter(c=>c.suite==='course');
  $('#provenance').textContent=`历史回放 · ${report.data_origin} · ${report.run_id} · 证据校验 ${report.integrity.status} · 原执行 ${report.status}`;
  if(!cases.length){$('#checks').textContent='本轮没有课程案例，请选择课程记录或运行新实验。';return;}
  $('#checks').innerHTML='<h3>动作检查</h3>'+cases.map(c=>`<details><summary>${c.parameters.requested_kib} KiB / 第 ${c.parameters.repeat} 次 · ${c.parameters.course_code==='student'?'学生代码':'参考实现'} · ${esc(c.validation?.status)}</summary><ul>${(c.validation?.checks||[]).map(x=>`<li>${esc(x.id)}：实际 ${esc(x.observed)}，预期 ${esc(x.expected)} · ${esc(x.status)}</li>`).join('')}</ul>${c.error?`<pre>${esc(JSON.stringify(c.error,null,2))}</pre>`:''}</details>`).join('');
  $('#observations').innerHTML='<label for="lesson-case">选择大小与重复次数</label><select id="lesson-case">'+cases.map(c=>`<option value="${esc(c.id)}">${c.parameters.requested_kib} KiB / 第 ${c.parameters.repeat} 次</option>`).join('')+'</select><div id="case-observation"></div>';
  const initial=cases.find(c=>c.parameters.requested_kib===16384&&c.data)||cases[0];
  $('#lesson-case').value=initial.id;
  $('#lesson-case').addEventListener('change',e=>showCase(cases.find(c=>c.id===e.target.value)));
  showCase(initial);
  $('#report-download').href='/api/export?format=json&id='+encodeURIComponent(id);$('#report-download').download='lesson-evidence.json';$('#report-download').hidden=false;
}catch(e){report=null;$('#provenance').textContent='记录读取失败，没有替换成其他结果。';$('#error').textContent=e.message;}}
async function refresh(preferred){const runs=(await api('/api/runs')).filter(r=>r.suites?.includes('course'));$('#lesson-run').innerHTML=runs.map(r=>`<option value="${esc(r.id)}">${esc(r.group)} · ${esc(r.run_id)} · ${esc(r.status)} · ${r.count} 项</option>`).join('');const desired=preferred||identifier;const id=runs.find(r=>r.id===desired)?.id||runs.find(r=>r.status==='completed')?.id||runs[0]?.id;if(id){$('#lesson-run').value=id;await select(id);}}
function jobUI(){const running=job?.status==='running';$('#job-log').textContent=job?.log||job?.error?.message||'';$('#run-student').disabled=running;$('#run-reference').disabled=running;$('#job').textContent=!job?'':running?'正在真实执行，完成前下方仍是已选历史。':`最近任务：${job.status}。${job.status==='failed'?'查看新记录的检查项；未完成的起始代码预期会失败。':'可选择新记录核对。'}`;}
async function run(mode){$('#error').textContent='';persist();try{job=await api('/api/run',{method:'POST',headers:{'Content-Type':'application/json','X-VMObserve-Token':config.token},body:JSON.stringify({mode})});jobUI();}catch(e){$('#error').textContent=e.message;}}
$('#prediction').addEventListener('input',persist);$('#explanation').addEventListener('input',persist);
$('#lesson-run').addEventListener('change',e=>select(e.target.value));$('#refresh').addEventListener('click',()=>refresh().catch(e=>$('#error').textContent=e.message));
$('#run-student').addEventListener('click',()=>run('student'));$('#run-reference').addEventListener('click',()=>run('course'));
$('#save-record').addEventListener('click',()=>{persist();if(!report){$('#record-status').textContent='先选择并读完一轮记录。';return;}notes.records.push({saved_at:new Date().toISOString(),prediction:notes.prediction,explanation:notes.explanation,evidence:binding(),assessment:'not_graded',answer_origin:answerOrigin});persist();$('#record-status').textContent=`已保存 ${notes.records.length} 条回答及对应证据；没有自动评定理解程度。`;});
$('#export-notes').addEventListener('click',()=>{persist();const blob=new Blob([JSON.stringify({schema_version:'vmobserve.worksheet/v1',answer_origin:answerOrigin,assessment:'not_graded',exported_at:new Date().toISOString(),...notes,draft_selected_evidence:binding()},null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='vmobserve-learning-notes.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);});
try{const saved=localStorage.getItem(key);if(saved){const parsed=JSON.parse(saved);if(typeof parsed.prediction==='string'&&typeof parsed.explanation==='string'&&Array.isArray(parsed.records))notes=parsed;}}catch(e){$('#save-status').textContent='旧草稿无法读取；没有删除旧数据。';}
$('#prediction').value=notes.prediction;$('#explanation').value=notes.explanation;
try{config=await api('/api/config');const lesson=await api('/api/lesson');$('#student-path').textContent=lesson.student_path;$('#student-code').textContent=lesson.student;$('#reference-code').textContent=lesson.reference;$('#worksheet').textContent=lesson.worksheet;job=await api('/api/job');await refresh(job?.new_run_ids?.[0]);jobUI();setInterval(async()=>{try{const before=job;job=await api('/api/job');jobUI();if(before?.status==='running'&&job?.status!=='running')await refresh(job.new_run_ids?.[0]);}catch(e){$('#error').textContent='本地服务连接中断：'+e.message;}},1500);}catch(e){$('#error').textContent=e.message;}

function showCase(c){
  if(!c?.data){$('#case-observation').textContent='本案例没有完整可用的采集；查看上方失败检查与执行日志。';return;}
  const names=['申请前','申请后','写到 1/4','写到 1/2','写完','释放后'];
  $('#case-observation').innerHTML=`<h3>${c.parameters.requested_kib} KiB / 第 ${c.parameters.repeat} 次 · 六步记录</h3><div class="table-scroll"><table><thead><tr><th>阶段</th><th>累计位置</th><th>RSS (KiB)</th><th>本步次缺页</th><th>映射</th></tr></thead><tbody>${c.data.samples.map((s,i)=>`<tr><td>${names[i]}</td><td>${s.written_positions}</td><td>${s.rss_kib}</td><td>${s.action_minor}</td><td>${s.mapping_present?'存在':'未发现'}</td></tr>`).join('')}</tbody></table></div>`;
}
