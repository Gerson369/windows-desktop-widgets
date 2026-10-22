import type {TodoItem} from '../main/types'
import {dateKey} from '../main/widget-suite'
export type TodoTab='pending'|'today'|'planned'|'completed'
export function isTodoOverdue(todo: Pick<TodoItem,'dueAt'|'completed'>, now: number): boolean {
  return !todo.completed && Boolean(todo.dueAt && Date.parse(todo.dueAt) < now)
}
export function groupTodos(todos:TodoItem[],now:number):Record<TodoTab,TodoItem[]> {
  const today=dateKey(now)
  const pending=todos.filter(todo=>!todo.completed).sort((a,b)=>a.order-b.order)
  return {pending,today:pending.filter(todo=>todo.dueAt && dateKey(new Date(todo.dueAt))===today),planned:pending.filter(todo=>todo.dueAt && dateKey(new Date(todo.dueAt))>today),completed:todos.filter(todo=>todo.completed).sort((a,b)=>a.order-b.order)}
}
