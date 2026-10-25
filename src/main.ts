import './style.css';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { BodyViewer, severityColor } from './body';
import { addPhoto, photoData, pruneCapturedPhotos } from './photos';
import { diaryStore, hasVault, pinLength, waitSeconds } from './storage';
import type { DiaryEvent, Followup, Mark, PhotoRef, Point3 } from './types';

type Screen = 'auth' | 'home' | 'events' | 'people' | 'part' | 'detail' | 'editor' | 'settings';

const app = document.querySelector<HTMLDivElement>('#app')!;
const actions = ['被锤', '被抓', '被掐', '被打', '被踢', '被推', '被拉扯', '被咬', '其他'];
const dateFmt = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const todayFmt = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const localDateTime = (date = new Date()): string => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const displayDate = (value: string): string => { try { return dateFmt.format(new Date(value)); } catch { return value; } };
const id = (): string => crypto.randomUUID();
const allEvents = (): DiaryEvent[] => [...diaryStore.data.events].sort((a, b) => b.at.localeCompare(a.at));
const allMarks = (): Mark[] => diaryStore.data.events.flatMap(e => e.marks);
const people = (): string[] => [...new Set(allMarks().flatMap(m => m.actors).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
const actorsOf = (event: DiaryEvent): string[] => [...new Set(event.marks.flatMap(m => m.actors))];
const pruneUnusedPhotos = (): void => {
  const uris = diaryStore.data.events.flatMap(event => [...event.photos, ...event.followups.flatMap(f => f.photos)]).map(photo => photo.uri);
  void pruneCapturedPhotos(uris).catch(() => {});
};
const icon = (name: string, size = 20): string => {
  const paths: Record<string, string> = {
    book: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H19v16H5.5A1.5 1.5 0 0 1 4 18.5zm0 13A1.5 1.5 0 0 1 5.5 17H19M8 8h7M8 11h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="m14 5-7 7 7 7"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    body: '<circle cx="12" cy="4" r="2"/><path d="M8 9c0-1 1-2 2-2h4c1 0 2 1 2 2v5l-2 2v5M8 9v5l2 2v5M5 9l3 1M19 9l-3 1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v1"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M10 2h4l.5 2.3 2 1.1 2.2-.8 2 3.4-1.8 1.5v2.4l1.8 1.5-2 3.4-2.2-.8-2 1.1L14 20h-4l-.5-2.3-2-1.1-2.2.8-2-3.4 1.8-1.5v-2.4L3.3 8.6l2-3.4 2.2.8 2-1.1z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m5 18 5-5 3 3 3-4 4 6"/>',
    camera: '<path d="M4 7h3l1.5-2h7L17 7h3v12H4z"/><circle cx="12" cy="13" r="3"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    leaf: '<path d="M20 4C10 4 4 9 4 16a4 4 0 0 0 4 4c7 0 12-6 12-16ZM4 20c4-6 8-9 13-11"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    edit: '<path d="m4 17-.5 3.5L7 20l12-12-3-3L4 17ZM14 7l3 3"/>',
    close: '<path d="M5 5l14 14M19 5 5 19"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h3M14 14h3M7 18h3"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.leaf}</svg>`;
};

let screen: Screen = 'auth';
let viewer: BodyViewer | null = null;
let draft: DiaryEvent | null = null;
let detailId: string | null = null;
let partFilter = '';
let personFilter = '';
let listQuery = '';
let listDate = '';
let calendarMonth = localDateTime().slice(0, 7);
let overlay: 'none' | 'select' | 'body' | 'followup' | 'photo' = 'none';
let selectedPoint: { part: string; point: Point3 } | null = null;
let editingFollowup: Followup | null = null;
let photoUri = '';
let authMode: 'create' | 'unlock' = hasVault() ? 'unlock' : 'create';
let chosenPinLength: 4 | 6 = 4;

function showToast(message: string): void {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 3300);
}

function setScreen(next: Screen): void {
  if (screen === 'editor' && next !== 'editor' && draft && !confirm('放弃尚未保存的修改吗？')) return;
  viewer?.dispose();
  viewer = null;
  overlay = 'none';
  screen = next;
  render();
  window.scrollTo(0, 0);
}

function header(title: string, subtitle = '', back?: Screen): string {
  return `<header class="page-header">
    <div class="header-row">${back ? `<button class="icon-button" data-go="${back}" aria-label="返回">${icon('back')}</button>` : `<span class="brand-mark">${icon('book', 22)}</span>`}
    <div class="header-text"><div class="eyebrow">园丁日记 · PRIVATE JOURNAL</div><h1>${esc(title)}</h1></div>
    <button class="icon-button" data-go="settings" aria-label="设置">${icon('settings')}</button></div>
    ${subtitle ? `<p class="header-sub">${esc(subtitle)}</p>` : ''}
  </header>`;
}

function nav(active: Screen): string {
  const tabs: [Screen, string, string][] = [['home', 'body', '人体图'], ['events', 'clock', '全部记录'], ['people', 'people', '按人查找']];
  return `<nav class="bottom-nav">${tabs.map(([key, glyph, label]) => `<button class="nav-item ${active === key ? 'active' : ''}" data-go="${key}">${icon(glyph, 21)}<span>${label}</span></button>`).join('')}</nav>`;
}

function empty(title: string, description: string): string {
  return `<div class="empty"><div class="empty-icon">${icon('leaf', 30)}</div><strong>${esc(title)}</strong><p>${esc(description)}</p></div>`;
}

function renderAuth(): void {
  const create = authMode === 'create';
  app.innerHTML = `<main class="auth-page">
    <div class="auth-decoration"><span class="deco-leaf one">✦</span><span class="deco-leaf two">✧</span><div class="book-emblem">${icon('book', 50)}<span class="emblem-sprout">${icon('leaf', 22)}</span></div></div>
    <div class="auth-content"><div class="eyebrow">A QUIET PLACE TO KEEP YOUR NOTES</div><h1>园丁日记</h1><p class="auth-tagline">给每一段经历，留一页自己的记录。</p>
      <form id="auth-form" class="auth-card"><div class="form-heading">${create ? '设置应用密码' : '欢迎回来'}</div>
      <p class="muted">${create ? '所有记录只保存在这台手机上。请选择密码长度。' : `请输入 ${pinLength()} 位数字密码，打开你的日记。`}</p>
      ${create ? `<div class="segmented"><button type="button" class="${chosenPinLength === 4 ? 'on' : ''}" data-pin-length="4">4 位密码</button><button type="button" class="${chosenPinLength === 6 ? 'on' : ''}" data-pin-length="6">6 位密码</button></div>` : ''}
      <label class="field"><span>密码</span><input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" minlength="${create ? chosenPinLength : pinLength()}" maxlength="${create ? chosenPinLength : pinLength()}" autocomplete="off" placeholder="请输入数字密码" required /></label>
      ${create ? `<label class="field"><span>再次输入</span><input id="pin-confirm" type="password" inputmode="numeric" pattern="[0-9]*" minlength="${chosenPinLength}" maxlength="${chosenPinLength}" autocomplete="off" placeholder="确认数字密码" required /></label>` : ''}
      <button class="primary full" type="submit">${create ? '开始使用' : '进入日记'} ${icon('chevron', 18)}</button>
      ${!create ? `<button type="button" class="text-button small" id="forgot">忘记密码？</button>` : ''}
      </form><p class="privacy-note">${icon('lock', 15)} 本地保存 · 不发送通知</p></div></main>`;
  bindCommon();
  document.querySelectorAll<HTMLButtonElement>('[data-pin-length]').forEach(btn => btn.addEventListener('click', () => {
    chosenPinLength = Number(btn.dataset.pinLength) as 4 | 6;
    renderAuth();
  }));
  document.querySelector<HTMLFormElement>('#auth-form')!.addEventListener('submit', async ev => {
    ev.preventDefault();
    const pin = (document.querySelector<HTMLInputElement>('#pin')!.value).trim();
    try {
      if (create) {
        const confirm = document.querySelector<HTMLInputElement>('#pin-confirm')!.value.trim();
        if (!new RegExp(`^\\d{${chosenPinLength}}$`).test(pin)) return showToast(`请输入 ${chosenPinLength} 位数字密码`);
        if (pin !== confirm) return showToast('两次输入的密码不一致');
        await diaryStore.create(pin);
      } else {
        if (!new RegExp(`^\\d{${pinLength()}}$`).test(pin)) return showToast(`请输入 ${pinLength()} 位数字密码`);
        if (!(await diaryStore.unlock(pin))) return showToast(waitSeconds() ? `密码错误，请 ${waitSeconds()} 秒后重试` : '密码错误，请重试');
      }
      setScreen('home');
    } catch (err) { showToast(err instanceof Error ? err.message : '操作失败'); }
  });
  document.querySelector('#forgot')?.addEventListener('click', () => {
    showToast('忘记密码后只能通过系统设置清除本应用数据；原记录也会被清除。');
  });
}

function renderHome(): void {
  const events = allEvents();
  app.innerHTML = `<div class="app-shell home-page">${header('身体地图', todayFmt.format(new Date()))}
    <main class="content home-content"><section class="hero-card"><div class="hero-top"><div><div class="eyebrow">BODY MAP</div><h2>轻触一个位置</h2><p>旋转查看正背面，放大找到具体部位。</p></div><span class="hero-count">${allMarks().length}<small>处标记</small></span></div>
      <div id="body-view" class="body-view" aria-label="可旋转的人体图"><span class="view-label" data-view-label>当前视角：正面</span><span class="side-label" data-side-label="left">左</span><span class="side-label" data-side-label="right">右</span><div class="view-controls"><button data-face="front">正面</button><button data-face="back">背面</button></div><div class="zoom-controls"><button data-zoom="in" aria-label="放大人体图">+</button><button data-zoom="out" aria-label="缩小人体图">−</button></div></div>
      <div class="model-hint"><span>轻触查看部位 · 双指缩放与移动</span></div></section>
      <div class="home-actions"><button class="primary" id="new-event">${icon('plus')} 新增事件</button><button class="secondary" data-go="events">查看全部 ${icon('chevron', 17)}</button></div>
      <section class="section"><div class="section-title"><h2>最近记录</h2><button class="text-button" data-go="events">查看全部</button></div>
      ${events.length ? events.slice(0, 2).map(eventCard).join('') : empty('这里还没有记录', '点击人体上的位置，或使用“新增事件”开始。')}</section></main>${nav('home')}</div><div id="overlay"></div>`;
  bindCommon();
  document.querySelector('#new-event')!.addEventListener('click', () => startEditor());
  document.querySelectorAll<HTMLElement>('[data-event-id]').forEach(el => el.addEventListener('click', () => openDetail(el.dataset.eventId!)));
  viewer = new BodyViewer(document.querySelector<HTMLElement>('#body-view')!, sel => {
    selectedPoint = sel;
    overlay = 'select';
    renderOverlay();
  }, allMarks());
  bindZoom();
}

function eventMatches(event: DiaryEvent): boolean {
  const query = listQuery.trim().toLowerCase();
  const content = [event.place, event.description, ...event.marks.map(m => `${m.part} ${m.action} ${m.actors.join(' ')}`), ...event.followups.map(f => f.text)].join(' ').toLowerCase();
  return (!query || content.includes(query)) && (!listDate || localDateTime(new Date(event.at)).slice(0, 10) === listDate);
}

function calendarHtml(): string {
  const [year, month] = calendarMonth.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(year, month, 0).getDate();
  const today = localDateTime().slice(0, 10);
  const days = Array.from({ length: offset }, () => '<span></span>');
  for (let day = 1; day <= count; day++) {
    const date = `${calendarMonth}-${String(day).padStart(2, '0')}`;
    days.push(`<button type="button" class="calendar-day ${date === listDate ? 'selected' : ''} ${date === today ? 'today' : ''}" data-calendar-day="${date}">${day}</button>`);
  }
  return `<div class="calendar-popover" role="dialog" aria-label="按日期筛选"><div class="calendar-head"><button type="button" data-calendar-step="-1" aria-label="上个月">‹</button><strong>${year} 年 ${month} 月</strong><button type="button" data-calendar-step="1" aria-label="下个月">›</button></div><div class="calendar-grid">${'一二三四五六日'.split('').map(d => `<span class="weekday">${d}</span>`).join('')}${days.join('')}</div><div class="calendar-footer"><button type="button" data-calendar-clear>清除</button><button type="button" data-calendar-today>今天</button></div></div>`;
}

function bindCalendar(): void {
  const host = document.querySelector<HTMLElement>('#calendar-host')!;
  const button = host.querySelector<HTMLButtonElement>('#calendar-toggle')!;
  let outside: ((ev: PointerEvent) => void) | null = null;
  const close = (): void => {
    host.querySelector('.calendar-popover')?.remove();
    button.setAttribute('aria-expanded', 'false');
    if (outside) document.removeEventListener('pointerdown', outside);
    outside = null;
  };
  const open = (): void => {
    host.insertAdjacentHTML('beforeend', calendarHtml());
    button.setAttribute('aria-expanded', 'true');
    outside = ev => { if (!host.contains(ev.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    host.querySelectorAll<HTMLElement>('[data-calendar-step]').forEach(el => el.addEventListener('click', () => {
      const [y, m] = calendarMonth.split('-').map(Number);
      const next = new Date(y, m - 1 + Number(el.dataset.calendarStep), 1);
      calendarMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
      close(); open();
    }));
    host.querySelectorAll<HTMLElement>('[data-calendar-day]').forEach(el => el.addEventListener('click', () => { listDate = el.dataset.calendarDay!; update(); }));
    host.querySelector<HTMLElement>('[data-calendar-clear]')!.addEventListener('click', () => { listDate = ''; update(); });
    host.querySelector<HTMLElement>('[data-calendar-today]')!.addEventListener('click', () => { listDate = localDateTime().slice(0, 10); calendarMonth = listDate.slice(0, 7); update(); });
  };
  const update = (): void => {
    close();
    button.innerHTML = `${icon('calendar', 19)}${listDate ? `<span>${esc(listDate.slice(5).replace('-', '/'))}</span>` : ''}`;
    button.classList.toggle('chosen', !!listDate);
    button.setAttribute('aria-label', listDate ? `日期筛选：${listDate}` : '按日期筛选');
    refreshEventList();
  };
  button.addEventListener('click', () => host.querySelector('.calendar-popover') ? close() : open());
}

function eventCard(event: DiaryEvent): string {
  const score = Math.max(...event.marks.map(m => m.severity), 0);
  const names = actorsOf(event);
  return `<button class="event-card" data-event-id="${esc(event.id)}"><div class="event-card-top"><span class="event-date">${esc(displayDate(event.at))}</span><span class="score-pill" style="--score:${severityColor(score)}">最高 ${score} 分</span></div>
    <strong>${esc(event.marks.map(m => m.part).filter((v, i, a) => a.indexOf(v) === i).join(' · '))}</strong>
    <p>${esc(event.description || event.place || '查看事件详情')}</p><div class="event-meta"><span>${icon('people', 15)} ${esc(names.join('、') || '未填写')}</span><span>${event.followups.length ? `${event.followups.length} 条后续` : '暂无后续'}</span></div></button>`;
}

function renderEvents(): void {
  const filtered = allEvents().filter(eventMatches);
  app.innerHTML = `<div class="app-shell">${header('全部记录', `共 ${diaryStore.data.events.length} 件事件`)}<main class="content">
    <div class="search-row"><label class="search-field">${icon('search', 19)}<input id="list-search" placeholder="搜索人名、部位、地点或经过" value="${esc(listQuery)}" /></label><div id="calendar-host" class="calendar-host"><button id="calendar-toggle" class="calendar-toggle ${listDate ? 'chosen' : ''}" type="button" aria-label="按日期筛选" aria-expanded="false">${icon('calendar', 19)}${listDate ? `<span>${esc(listDate.slice(5).replace('-', '/'))}</span>` : ''}</button></div></div>
    <div class="list-stack">${filtered.length ? filtered.map(eventCard).join('') : empty('没有找到记录', '试试其他关键词或日期。')}</div>
    <button class="floating-add" id="new-event" aria-label="新增事件">${icon('plus', 26)}</button></main>${nav('events')}</div>`;
  bindCommon();
  document.querySelector('#new-event')!.addEventListener('click', () => startEditor());
  document.querySelectorAll<HTMLElement>('[data-event-id]').forEach(el => el.addEventListener('click', () => openDetail(el.dataset.eventId!)));
  document.querySelector<HTMLInputElement>('#list-search')!.addEventListener('input', ev => { listQuery = (ev.target as HTMLInputElement).value; refreshEventList(); });
  bindCalendar();
}

function refreshEventList(): void {
  const filtered = allEvents().filter(eventMatches);
  const host = document.querySelector<HTMLElement>('.list-stack')!;
  host.innerHTML = filtered.length ? filtered.map(eventCard).join('') : empty('没有找到记录', '试试其他关键词或日期。');
  host.querySelectorAll<HTMLElement>('[data-event-id]').forEach(el => el.addEventListener('click', () => openDetail(el.dataset.eventId!)));
}

function renderPeople(): void {
  const names = people();
  app.innerHTML = `<div class="app-shell">${header('按人查找', `已记录 ${names.length} 个名字或代称`)}<main class="content">
    <div class="section-note">名字和代称完全由你填写。同一个人在不同事件中使用相同写法，就会归在一起。</div>
    <div class="people-list">${names.length ? names.map(name => {
      const count = allEvents().filter(e => e.marks.some(m => m.actors.includes(name))).length;
      return `<button class="person-card" data-person="${esc(name)}"><span class="person-avatar">${esc(name.slice(0, 1))}</span><span><strong>${esc(name)}</strong><small>${count} 件相关事件</small></span>${icon('chevron', 18)}</button>`;
    }).join('') : empty('暂无名字', '添加事件时可填写姓名、代称或“未知”。')}</div></main>${nav('people')}</div>`;
  bindCommon();
  document.querySelectorAll<HTMLElement>('[data-person]').forEach(el => el.addEventListener('click', () => { personFilter = el.dataset.person!; setScreen('part'); }));
}

function renderPart(): void {
  const byPerson = !!personFilter;
  const filtered = allEvents().filter(e => byPerson ? e.marks.some(m => m.actors.includes(personFilter)) : e.marks.some(m => m.part === partFilter));
  app.innerHTML = `<div class="app-shell">${header(byPerson ? personFilter : partFilter, byPerson ? '相关事件' : '该部位的全部记录', byPerson ? 'people' : 'home')}
    <main class="content"><div class="result-count">${filtered.length} 件事件</div><div class="list-stack">${filtered.length ? filtered.map(eventCard).join('') : empty('暂无记录', '可以从人体图上选择位置新增事件。')}</div></main>${nav(byPerson ? 'people' : 'home')}</div>`;
  bindCommon();
  document.querySelectorAll<HTMLElement>('[data-event-id]').forEach(el => el.addEventListener('click', () => openDetail(el.dataset.eventId!)));
}

function photosHtml(photos: PhotoRef[]): string {
  if (!photos.length) return '';
  return `<div class="photo-strip">${photos.map(p => `<button class="photo-tile" data-photo="${esc(p.uri)}" aria-label="查看照片 ${esc(p.name)}">${icon('image', 24)}<img alt="" loading="lazy" /><span>${esc(p.name)}</span></button>`).join('')}</div>`;
}

function renderDetail(): void {
  const event = diaryStore.data.events.find(e => e.id === detailId);
  if (!event) return setScreen('events');
  app.innerHTML = `<div class="app-shell">${header('事件记录', displayDate(event.at), 'events')}<main class="content detail-content">
    <div class="detail-actions"><button class="secondary small" id="edit-event">${icon('edit', 17)} 修改</button><button class="danger-text" id="delete-event">${icon('trash', 17)} 删除</button></div>
    <section class="detail-panel"><div class="eyebrow">TIME & PLACE</div><h2>${esc(displayDate(event.at))}</h2><p>${icon('leaf', 17)} ${esc(event.place || '地点未填写')}</p></section>
    <section class="section"><h2>事情经过</h2><p class="prose">${esc(event.description || '暂无文字记录')}</p>${photosHtml(event.photos)}</section>
    <section class="section"><div class="section-title"><h2>涉及部位</h2><span>${event.marks.length} 处</span></div><div class="mark-list">${event.marks.map(m => `<div class="detail-mark"><span class="mark-dot" style="background:${severityColor(m.severity)}"></span><div><strong>${esc(m.part)} · ${esc(m.action)}</strong><small>${esc(m.actors.join('、'))}</small></div><span class="severity-badge">${m.severity}/10</span></div>`).join('')}</div></section>
    <section class="section"><div class="section-title"><h2>后续记录</h2><span>${event.followups.length} 条</span></div>
      <div class="followups">${event.followups.length ? [...event.followups].sort((a,b) => b.at.localeCompare(a.at)).map(f => `<article class="followup-card"><div class="followup-top"><span>${esc(displayDate(f.at))}</span><div><button class="tiny-button" data-edit-followup="${esc(f.id)}" aria-label="修改后续">${icon('edit', 16)}</button><button class="tiny-button" data-delete-followup="${esc(f.id)}" aria-label="删除后续">${icon('trash', 16)}</button></div></div><p>${esc(f.text)}</p>${photosHtml(f.photos)}</article>`).join('') : `<p class="muted">还没有补充后续。</p>`}</div>
      <button class="outline full" id="add-followup">${icon('plus', 18)} 补充后续</button></section></main>${nav('events')}</div><div id="overlay"></div>`;
  bindCommon();
  bindPhotoTiles();
  document.querySelector('#edit-event')!.addEventListener('click', () => startEditor(event));
  document.querySelector('#delete-event')!.addEventListener('click', async () => {
    if (!confirm('确定删除这件事件及全部后续吗？此操作无法撤销。')) return;
    diaryStore.data.events = diaryStore.data.events.filter(e => e.id !== event.id);
    await diaryStore.save();
    pruneUnusedPhotos();
    showToast('事件已删除'); setScreen('events');
  });
  document.querySelector('#add-followup')!.addEventListener('click', () => openFollowup());
  document.querySelectorAll<HTMLElement>('[data-edit-followup]').forEach(el => el.addEventListener('click', () => openFollowup(event.followups.find(f => f.id === el.dataset.editFollowup))));
  document.querySelectorAll<HTMLElement>('[data-delete-followup]').forEach(el => el.addEventListener('click', async () => {
    if (!confirm('确定删除这条后续记录吗？')) return;
    event.followups = event.followups.filter(f => f.id !== el.dataset.deleteFollowup);
    await diaryStore.save(); pruneUnusedPhotos(); renderDetail();
  }));
}

function newEvent(): DiaryEvent {
  return { id: id(), at: new Date().toISOString(), place: '', description: '', marks: [], photos: [], followups: [], updatedAt: new Date().toISOString() };
}

function startEditor(event?: DiaryEvent, point?: { part: string; point: Point3 }): void {
  draft = event ? structuredClone(event) : newEvent();
  if (point) draft.marks.push({ id: id(), part: point.part, point: point.point, action: '被打', severity: 5, actors: [] });
  setScreen('editor');
}

function markEditor(mark: Mark): string {
  const selectedAction = actions.includes(mark.action) ? mark.action : '其他';
  return `<div class="mark-editor" data-mark="${esc(mark.id)}"><div class="mark-editor-head"><span class="mark-dot" style="background:${severityColor(mark.severity)}"></span><strong>${esc(mark.part)}</strong><button class="tiny-button" data-remove-mark="${esc(mark.id)}" aria-label="移除部位">${icon('close', 17)}</button></div>
    <div class="two-fields"><label class="field"><span>类型</span><select data-mark-field="action-select">${actions.map(a => `<option value="${esc(a)}" ${a === selectedAction ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label><label class="field"><span>严重程度 <b class="score-inline">${mark.severity}/10</b></span><input type="range" min="0" max="10" value="${mark.severity}" data-mark-field="severity" /></label></div>
    <label class="field custom-action ${selectedAction === '其他' ? '' : 'hidden'}"><span>自行填写类型</span><input data-mark-field="action-custom" value="${selectedAction === '其他' ? esc(mark.action) : ''}" placeholder="例如：被拽住" /></label>
    <label class="field"><span>相关人名或代称</span><input data-mark-field="actors" value="${esc(mark.actors.join('、'))}" placeholder="多人请用顿号分开；可填“未知”" /></label></div>`;
}

function renderEditor(): void {
  if (!draft) return setScreen('home');
  const existing = diaryStore.data.events.some(e => e.id === draft!.id);
  app.innerHTML = `<div class="app-shell editor-page">${header(existing ? '修改事件' : '新增事件', '一件事可以记录多个部位', existing ? 'detail' : 'home')}
    <main class="content"><section class="section form-section"><div class="section-title"><h2>基本信息</h2><span>01 / 03</span></div>
      <label class="field"><span>发生时间</span><input id="event-time" type="datetime-local" value="${esc(localDateTime(new Date(draft.at)))}" /></label>
      <label class="field"><span>地点</span><input id="event-place" value="${esc(draft.place)}" placeholder="可以填写具体地点，也可以留空" /></label>
      <label class="field"><span>事情经过</span><textarea id="event-description" rows="5" placeholder="按自己的方式写下经过……">${esc(draft.description)}</textarea></label></section>
    <section class="section form-section"><div class="section-title"><h2>部位与行为</h2><span>02 / 03</span></div>
      <p class="muted">点击人体图选位置。每个位置可分别填写类型、严重程度和相关人。</p>
      <div id="draft-marks">${draft.marks.length ? draft.marks.map(markEditor).join('') : empty('尚未选择部位', '点击下面的按钮，在人体图上留下标记。')}</div>
      <button class="outline full" id="add-mark">${icon('body', 19)} 在人体图上选部位</button></section>
    <section class="section form-section"><div class="section-title"><h2>相关照片</h2><span>03 / 03</span></div>
      <p class="muted">相册照片保留在原位置，请勿删除原图；新拍照片保存在本应用内。</p><div id="draft-photos">${draft.photos.map(photoChip).join('')}</div>
      <div class="photo-actions"><button class="outline" id="pick-photo">${icon('image', 18)} 从相册选择</button><button class="outline" id="take-photo">${icon('camera', 18)} 拍照</button></div></section>
    <button class="primary full save-button" id="save-event">保存事件 ${icon('chevron', 18)}</button></main></div><div id="overlay"></div>`;
  bindCommon(); bindEditorFields(); bindDraftPhotos();
  document.querySelector('#add-mark')!.addEventListener('click', () => { overlay = 'body'; renderOverlay(); });
  document.querySelector('#pick-photo')!.addEventListener('click', () => appendPhoto('gallery', 'event'));
  document.querySelector('#take-photo')!.addEventListener('click', () => appendPhoto('camera', 'event'));
  document.querySelector('#save-event')!.addEventListener('click', saveEvent);
}

function bindEditorFields(): void {
  if (!draft) return;
  document.querySelector<HTMLInputElement>('#event-time')!.addEventListener('change', ev => {
    const value = (ev.target as HTMLInputElement).value;
    if (value) draft!.at = new Date(value).toISOString();
  });
  document.querySelector<HTMLInputElement>('#event-place')!.addEventListener('input', ev => { draft!.place = (ev.target as HTMLInputElement).value; });
  document.querySelector<HTMLTextAreaElement>('#event-description')!.addEventListener('input', ev => { draft!.description = (ev.target as HTMLTextAreaElement).value; });
  document.querySelectorAll<HTMLElement>('[data-mark]').forEach(card => {
    const mark = draft!.marks.find(m => m.id === card.dataset.mark)!;
    const actionSelect = card.querySelector<HTMLSelectElement>('[data-mark-field="action-select"]')!;
    const custom = card.querySelector<HTMLElement>('.custom-action')!;
    actionSelect.addEventListener('change', () => {
      const isCustom = actionSelect.value === '其他';
      custom.classList.toggle('hidden', !isCustom);
      mark.action = isCustom ? card.querySelector<HTMLInputElement>('[data-mark-field="action-custom"]')!.value : actionSelect.value;
    });
    card.querySelector<HTMLInputElement>('[data-mark-field="action-custom"]')!.addEventListener('input', ev => { mark.action = (ev.target as HTMLInputElement).value; });
    card.querySelector<HTMLInputElement>('[data-mark-field="severity"]')!.addEventListener('input', ev => {
      mark.severity = Number((ev.target as HTMLInputElement).value);
      card.querySelector('.score-inline')!.textContent = `${mark.severity}/10`;
      (card.querySelector('.mark-dot') as HTMLElement).style.background = severityColor(mark.severity);
    });
    card.querySelector<HTMLInputElement>('[data-mark-field="actors"]')!.addEventListener('input', ev => {
      mark.actors = (ev.target as HTMLInputElement).value.split(/[、,，;；]/).map(s => s.trim()).filter(Boolean);
    });
  });
  document.querySelectorAll<HTMLElement>('[data-remove-mark]').forEach(el => el.addEventListener('click', () => {
    draft!.marks = draft!.marks.filter(m => m.id !== el.dataset.removeMark); renderEditor();
  }));
}

function photoChip(photo: PhotoRef): string {
  return `<div class="photo-chip" data-chip-uri="${esc(photo.uri)}"><span><img alt="" />${icon('image', 17)} ${esc(photo.name)}</span><button class="tiny-button" data-remove-photo="${esc(photo.id)}" aria-label="移除照片">${icon('close', 16)}</button></div>`;
}

function bindPhotoChipPreviews(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-chip-uri]').forEach(chip => {
    const uri = chip.dataset.chipUri!;
    photoData(uri, 240).then(url => {
      const image = chip.querySelector<HTMLImageElement>('img');
      if (image && chip.isConnected) { image.src = url; image.style.display = 'block'; chip.querySelector('svg')?.remove(); }
    }).catch(() => {});
  });
}

function bindDraftPhotos(): void {
  bindPhotoChipPreviews();
  document.querySelectorAll<HTMLElement>('[data-remove-photo]').forEach(el => el.addEventListener('click', () => {
    if (!draft) return;
    draft.photos = draft.photos.filter(p => p.id !== el.dataset.removePhoto); renderEditor();
  }));
}

async function appendPhoto(source: 'gallery' | 'camera', target: 'event' | 'followup'): Promise<void> {
  if (source === 'gallery') showToast('请选择原图；添加后请不要删除或移动它。');
  try {
    const photo = await addPhoto(source);
    if (source === 'camera') await photoData(photo.uri, 320);
    if (target === 'event' && draft) { draft.photos.push(photo); renderEditor(); }
    if (target === 'followup' && editingFollowup) { editingFollowup.photos.push(photo); renderOverlay(); }
    showToast('照片已加入这条记录');
  } catch (err) {
    const message = err instanceof Error ? err.message : '无法添加照片';
    if (!/cancel/i.test(message)) showToast(message);
  }
}

async function saveEvent(): Promise<void> {
  if (!draft) return;
  if (!draft.marks.length) return showToast('请至少选择一个部位');
  if (!draft.description.trim()) return showToast('请填写事情经过');
  for (const mark of draft.marks) {
    if (!mark.action.trim()) return showToast(`请填写“${mark.part}”的类型`);
    if (!mark.actors.length) mark.actors = ['未知'];
  }
  draft.updatedAt = new Date().toISOString();
  const existing = diaryStore.data.events.findIndex(e => e.id === draft!.id);
  if (existing >= 0) diaryStore.data.events[existing] = draft;
  else diaryStore.data.events.push(draft);
  try {
    await diaryStore.save();
    pruneUnusedPhotos();
    detailId = draft.id;
    draft = null;
    showToast('事件已保存');
    setScreen('detail');
  } catch { showToast('保存失败，请重试'); }
}

function openDetail(eventId: string): void { detailId = eventId; setScreen('detail'); }

function openFollowup(followup?: Followup): void {
  editingFollowup = followup ? structuredClone(followup) : { id: id(), at: new Date().toISOString(), text: '', photos: [] };
  overlay = 'followup'; renderOverlay();
}

function bindPhotoTiles(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-photo]').forEach(el => {
    el.addEventListener('click', () => { photoUri = el.dataset.photo!; overlay = 'photo'; renderOverlay(); });
    photoData(el.dataset.photo!, 280).then(url => {
      if (!el.isConnected) return;
      const image = el.querySelector<HTMLImageElement>('img');
      if (image) { image.src = url; image.style.display = 'block'; }
      el.querySelector('svg')?.remove();
    }).catch(() => {});
  });
}

function closeOverlay(): void {
  if (overlay === 'body') { viewer?.dispose(); viewer = null; }
  overlay = 'none';
  document.querySelector('#overlay')!.innerHTML = '';
}

function renderOverlay(): void {
  const host = document.querySelector<HTMLElement>('#overlay');
  if (!host) return;
  if (overlay === 'body') { viewer?.dispose(); viewer = null; }
  if (overlay === 'select' && selectedPoint) {
    const count = allEvents().filter(e => e.marks.some(m => m.part === selectedPoint!.part)).length;
    host.innerHTML = `<div class="overlay-backdrop" data-close-overlay></div><div class="bottom-sheet"><div class="sheet-handle"></div><div class="eyebrow">SELECTED AREA</div><h2>${esc(selectedPoint.part)}</h2><p>${count} 件已有记录</p><button class="primary full" id="from-point">${icon('plus', 19)} 记录这个位置</button><button class="outline full" id="view-point">查看该部位的记录</button></div>`;
    host.querySelector('#from-point')!.addEventListener('click', () => startEditor(undefined, selectedPoint!));
    host.querySelector('#view-point')!.addEventListener('click', () => { partFilter = selectedPoint!.part; personFilter = ''; setScreen('part'); });
  } else if (overlay === 'body') {
    host.innerHTML = `<div class="full-modal"><div class="modal-header"><button class="icon-button" data-close-overlay aria-label="关闭">${icon('close')}</button><div><div class="eyebrow">SELECT LOCATION</div><h2>选择身体部位</h2></div><span></span></div><div id="picker-body" class="picker-body"><span class="view-label" data-view-label>当前视角：正面</span><span class="side-label" data-side-label="left">左</span><span class="side-label" data-side-label="right">右</span><div class="view-controls"><button data-face="front">正面</button><button data-face="back">背面</button></div><div class="zoom-controls"><button data-zoom="in" aria-label="放大人体图">+</button><button data-zoom="out" aria-label="缩小人体图">−</button></div></div><div class="picker-instruction">轻触选择部位 · 双指缩放与移动</div></div>`;
    viewer = new BodyViewer(host.querySelector<HTMLElement>('#picker-body')!, sel => {
      draft!.marks.push({ id: id(), part: sel.part, point: sel.point, action: '被打', severity: 5, actors: [] });
      closeOverlay(); renderEditor();
      setTimeout(() => document.querySelector('.mark-editor:last-child')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    }, draft?.marks ?? []);
    bindZoom(host);
  } else if (overlay === 'followup' && editingFollowup) {
    host.innerHTML = `<div class="overlay-backdrop" data-close-overlay></div><div class="bottom-sheet tall"><div class="sheet-handle"></div><div class="eyebrow">FOLLOW UP</div><h2>${diaryStore.data.events.find(e => e.id === detailId)?.followups.some(f => f.id === editingFollowup!.id) ? '修改后续' : '补充后续'}</h2>
      <label class="field"><span>记录时间</span><input id="followup-time" type="datetime-local" value="${esc(localDateTime(new Date(editingFollowup.at)))}" /></label>
      <label class="field"><span>后续内容</span><textarea id="followup-text" rows="4" placeholder="例如：第二天的变化、处理情况……">${esc(editingFollowup.text)}</textarea></label>
      <div class="photo-chips">${editingFollowup.photos.map(photoChip).join('')}</div><p class="muted">相册照片请勿删除原图；新拍照片保存在本应用内。</p>
      <div class="photo-actions"><button class="outline" id="followup-pick">${icon('image', 18)} 相册</button><button class="outline" id="followup-camera">${icon('camera', 18)} 拍照</button></div>
      <button class="primary full" id="save-followup">保存后续</button></div>`;
    host.querySelector('#followup-pick')!.addEventListener('click', () => appendPhoto('gallery', 'followup'));
    host.querySelector('#followup-camera')!.addEventListener('click', () => appendPhoto('camera', 'followup'));
    host.querySelector<HTMLInputElement>('#followup-time')!.addEventListener('change', ev => {
      const value = (ev.target as HTMLInputElement).value;
      if (value) editingFollowup!.at = new Date(value).toISOString();
    });
    host.querySelector<HTMLTextAreaElement>('#followup-text')!.addEventListener('input', ev => {
      editingFollowup!.text = (ev.target as HTMLTextAreaElement).value;
    });
    host.querySelectorAll<HTMLElement>('[data-remove-photo]').forEach(el => el.addEventListener('click', () => {
      editingFollowup!.photos = editingFollowup!.photos.filter(p => p.id !== el.dataset.removePhoto); renderOverlay();
    }));
    bindPhotoChipPreviews(host);
    host.querySelector('#save-followup')!.addEventListener('click', async () => {
      const text = (host.querySelector<HTMLTextAreaElement>('#followup-text')!.value).trim();
      const at = host.querySelector<HTMLInputElement>('#followup-time')!.value;
      if (!text) return showToast('请填写后续内容');
      if (!at) return showToast('请选择记录时间');
      const event = diaryStore.data.events.find(e => e.id === detailId)!;
      editingFollowup!.text = text;
      editingFollowup!.at = new Date(at).toISOString();
      const index = event.followups.findIndex(f => f.id === editingFollowup!.id);
      if (index >= 0) event.followups[index] = editingFollowup!;
      else event.followups.push(editingFollowup!);
      event.updatedAt = new Date().toISOString();
      await diaryStore.save();
      pruneUnusedPhotos();
      editingFollowup = null;
      closeOverlay(); renderDetail(); showToast('后续已保存');
    });
  } else if (overlay === 'photo') {
    host.innerHTML = `<div class="photo-viewer"><button class="photo-close" data-close-overlay aria-label="关闭">${icon('close', 23)}</button><div class="photo-loading">正在打开照片…</div><img alt="记录照片" /></div>`;
    const current = photoUri;
    photoData(current).then(url => {
      if (overlay !== 'photo' || photoUri !== current) return;
      const image = host.querySelector<HTMLImageElement>('img');
      if (image) { image.src = url; image.style.display = 'block'; }
      host.querySelector('.photo-loading')?.remove();
    }).catch(() => { const label = host.querySelector('.photo-loading'); if (label) label.textContent = '无法打开照片。请检查原图是否已被删除或移动。'; });
  }
  host.querySelectorAll<HTMLElement>('[data-close-overlay]').forEach(el => el.addEventListener('click', closeOverlay));
}

function bindZoom(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-zoom]').forEach(el => el.addEventListener('click', ev => {
    ev.stopPropagation();
    viewer?.zoom(el.dataset.zoom === 'in' ? 0.78 : 1.28);
  }));
  root.querySelectorAll<HTMLElement>('[data-face]').forEach(el => el.addEventListener('click', ev => {
    ev.stopPropagation();
    viewer?.face(el.dataset.face === 'back' ? 'back' : 'front');
  }));
}

function renderSettings(): void {
  app.innerHTML = `<div class="app-shell">${header('设置', '本机与隐私', 'home')}<main class="content settings-content">
    <div class="settings-hero"><span class="brand-mark large">${icon('book', 29)}</span><h2>园丁日记</h2><p>私人、本地、安静地记录。</p></div>
    <section class="section"><h2>应用密码</h2><p class="muted">当前使用 ${pinLength()} 位数字密码。退出登录后需要重新输入。</p>
      <form id="change-pin" class="settings-form"><label class="field"><span>当前密码</span><input name="old" type="password" inputmode="numeric" pattern="[0-9]*" required /></label>
      <label class="field"><span>新密码</span><input name="new" type="password" inputmode="numeric" pattern="[0-9]*" placeholder="4 位或 6 位数字" required /></label>
      <button class="outline full" type="submit">修改密码</button></form></section>
    <section class="section"><h2>数据说明</h2><p class="muted">记录仅保存在本机，不会发送通知。删除应用或清除应用数据会失去全部记录。相册照片只保存原图引用；如果删除或移动原图，日记中将无法打开。</p></section>
    <button class="danger-outline full" id="logout">退出登录</button></main>${nav('home')}</div>`;
  bindCommon();
  document.querySelector<HTMLFormElement>('#change-pin')!.addEventListener('submit', async ev => {
    ev.preventDefault();
    const form = ev.target as HTMLFormElement;
    const oldPin = (form.elements.namedItem('old') as HTMLInputElement).value;
    const newPin = (form.elements.namedItem('new') as HTMLInputElement).value;
    if (!/^\d{4}$|^\d{6}$/.test(newPin)) return showToast('新密码需要 4 位或 6 位数字');
    try {
      if (!(await diaryStore.changePin(oldPin, newPin))) return showToast('当前密码不正确');
      showToast('密码已修改'); renderSettings();
    } catch { showToast('修改失败，请重试'); }
  });
  document.querySelector('#logout')!.addEventListener('click', () => {
    diaryStore.lock(); authMode = 'unlock'; setScreen('auth');
  });
}

function bindCommon(): void {
  document.querySelectorAll<HTMLElement>('[data-go]').forEach(el => el.addEventListener('click', () => setScreen(el.dataset.go as Screen)));
}

function render(): void {
  switch (screen) {
    case 'auth': renderAuth(); break;
    case 'home': renderHome(); break;
    case 'events': renderEvents(); break;
    case 'people': renderPeople(); break;
    case 'part': renderPart(); break;
    case 'detail': renderDetail(); break;
    case 'editor': renderEditor(); break;
    case 'settings': renderSettings(); break;
  }
}

render();

if (Capacitor.isNativePlatform()) {
  void NativeApp.addListener('backButton', () => {
    if (overlay !== 'none') return closeOverlay();
    if (screen === 'editor') return setScreen(diaryStore.data.events.some(e => e.id === draft?.id) ? 'detail' : 'home');
    if (screen === 'detail') return setScreen('events');
    if (screen === 'part') return setScreen(personFilter ? 'people' : 'home');
    if (screen === 'settings' || screen === 'events' || screen === 'people') return setScreen('home');
    void NativeApp.exitApp();
  }).catch(() => {});
}
