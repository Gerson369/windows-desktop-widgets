<script setup lang="ts">
import { toolbox } from '../../toolbox'

const api=toolbox
import {ref,onBeforeUnmount,watch} from 'vue'
import type {AppData,StickyNote} from '../../../main/types'
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
  <form @submit.prevent="perform(add)"><input v-model="newTitle" maxlength="120" aria-label="新便签标题" placeholder="新便签标题"/><button>新建便签</button></form>
  <div v-for="note in data.notes" :key="note.id" class="entry"><input v-model="drafts[note.id].title" maxlength="120" aria-label="便签标题" @input="queue(note)" @blur="perform(()=>save(note))"/><textarea v-model="drafts[note.id].content" maxlength="50000" aria-label="便签内容" placeholder="随手记，自动保存" @input="queue(note)" @blur="perform(()=>save(note))"/><div class="row"><button @click="perform(()=>api.notes.show(note.id))">独立窗口</button><button @click="perform(()=>remove(note))">删除</button><small>自动保存到本机</small></div></div>
  <p v-if="!data.notes.length" class="hint">创建便签后即可直接编辑。</p><p v-if="error" role="alert">{{error}}</p>
</template>
