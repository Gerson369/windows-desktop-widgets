import type { TodoItem } from './types'

export function validateTodoReminder(value: unknown, now: number): string | undefined {
  if (value === null) return undefined
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= now) throw new Error('请选择将来的提醒时间。')
  return new Date(value).toISOString()
}

export function dueTodoReminders(todos: TodoItem[], now: number): TodoItem[] {
  return todos.filter(todo => !todo.completed && todo.reminderAt && Number.isFinite(Date.parse(todo.reminderAt)) && Date.parse(todo.reminderAt) <= now && todo.reminderNotifiedAt !== todo.reminderAt)
}
