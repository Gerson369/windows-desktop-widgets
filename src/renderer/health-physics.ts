export interface PhysicsBody {
  x: number; y: number; vx: number; vy: number
  width: number; height: number; angle: number; spin: number
  settled?: boolean
}
export function bodyHalfHeight(body: PhysicsBody): number {
  return Math.abs(Math.sin(body.angle)) * body.width / 2 + Math.abs(Math.cos(body.angle)) * body.height / 2
}
export function stepBody(body: PhysicsBody, elapsed: number, floor: number, width: number, bounce: number): PhysicsBody & { landed: boolean } {
  if (body.settled) return { ...body, y: Math.min(body.y, floor - bodyHalfHeight(body)), landed: false }
  const dt = Math.max(0, Math.min(.04, elapsed)), gravity = 900
  const next = { ...body, x: body.x + body.vx * dt, y: body.y + body.vy * dt + gravity * dt * dt / 2,
    vy: body.vy + gravity * dt, angle: body.angle + body.spin * dt, landed: false }
  if (next.x < body.width / 2 || next.x > width - body.width / 2) {
    next.x = Math.max(body.width / 2, Math.min(width - body.width / 2, next.x)); next.vx *= -.5
  }
  const half = bodyHalfHeight(next)
  if (next.y + half >= floor) {
    next.landed = true; next.y = floor - half; next.vy = -Math.abs(next.vy) * bounce
    next.vx *= .65; next.spin *= .55
    if (bounce > 0 && Math.abs(next.vy) < 14) {
      const target = Math.round(next.angle / Math.PI) * Math.PI
      next.angle += (target - next.angle) * Math.min(1, dt * 14)
      next.y = floor - bodyHalfHeight(next)
      if (Math.abs(target - next.angle) < .025) { next.angle = target; next.spin = 0; next.vx = 0; next.vy = 0; next.settled = true; next.y = floor - next.height / 2 }
    }
  }
  return next
}
