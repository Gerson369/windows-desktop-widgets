<script setup lang="ts">
import { toolbox } from '../../toolbox'

const api=toolbox
import {ref,onBeforeUnmount,watch} from 'vue'
import type {AppData,StickyNote} from '../../../main/types'
import AssistantIcon from '../AssistantIcon.vue'
const props=defineProps<{data:AppData}>()
const drafts=ref<Record<string,{title:string;content:string}>>({}),error=ref(''),newTitle=ref('')
const timers=new Map<string,ReturnType<typeof setTimeout>>()
watch(()=>props.data.notes,notes=>{for(const note of notes) if(!timers.has(note.id)) drafts.value[note.id]={title:note.title,content:note.content}},{immediate:true})
async function perform(action:()=>Promise<unknown>){try{await action();error.value=''}catch(reason){error.value=String(reason)}}
async function save(note:StickyNote){clearTimeout(timers.get(note.id));timers.delete(note.id);await api.notes.update(note.id,{...drafts.value[note.id]})}
function queue(note:StickyNote){clearTimeout(timers.get(note.id));timers.set(note.id,setTimeout(()=>{void perform(()=>save(note))},400))}
async function add(){const now=new Date().toISOString();await api.entity.upsert('notes',{id:crypto.randomUUID(),title:newTitle.value.trim()||'新便签',content:'',color:'#fff0a8',pinned:false,updatedAt:now});newTitle.value=''}
async function remove(note:StickyNote){clearTimeout(timers.get(note.id));timers.delete(note.id);if(confirm(`删除便签“${note.title}”？`))await api.entity.remove('notes',note.id)}
onBeforeUnmount(()=>{for(const [id,timer] of timers){clearTimeout(timer);const note=props.data.notes.find(note=>note.id===id);if(note)void save(note).catch(()=>undefined)}})
</script>
<template>
  <form @submit.prevent="perform(add)"><input v-model="newTitle" maxlength="120" aria-label="新便签标题" placeholder="新便签标题"/><button class="note-add"><AssistantIcon name="plus"/>新建</button></form>
  <div v-for="note in data.notes" :key="note.id" class="entry note-entry"><input class="note-title" v-model="drafts[note.id].title" maxlength="120" aria-label="便签标题" @input="queue(note)" @blur="perform(()=>save(note))"/><textarea v-model="drafts[note.id].content" maxlength="50000" aria-label="便签内容" placeholder="随手记，自动保存" @input="queue(note)" @blur="perform(()=>save(note))"/><div class="row"><button @click="perform(()=>api.notes.show(note.id))">独立窗口</button><button @click="perform(()=>remove(note))">删除</button><small>自动保存到本机</small></div></div>
  <p v-if="!data.notes.length" class="empty-state">记下一个念头，从新建便签开始。</p><p v-if="error" role="alert">{{error}}</p>
</template>

<style scoped>
.note-add{display:flex;align-items:center;gap:4px;white-space:nowrap}.note-add svg{width:15px;height:15px}.note-entry .note-title{width:100%;font-size:14px;font-weight:600;background:transparent;border-color:transparent;padding-left:2px}.note-entry textarea{display:block;min-height:114px;margin:6px 0 8px;line-height:1.8;background:#10201945;border-color:#ffffff1c;resize:vertical}.note-entry .row{gap:6px}.note-entry .row button{padding:3px 8px;min-height:28px;font-size:11px}.note-entry .row small{margin-left:auto;font-size:10px}
</style>
