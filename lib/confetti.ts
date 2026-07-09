'use client'

// 統一的 confetti 管理器，解決跨平台兼容性問題
class ConfettiManager {
  private confettiModule: any = null
  private isLoading = false
  private loadPromise: Promise<any> | null = null

  async loadConfetti(): Promise<any> {
    if (this.confettiModule) return this.confettiModule
    if (this.loadPromise) return this.loadPromise
    if (typeof window === 'undefined') return null

    this.isLoading = true
    this.loadPromise = this.attemptLoad()

    try {
      this.confettiModule = await this.loadPromise
      return this.confettiModule
    } catch (error) {
      console.warn('Failed to load confetti:', error)
      return null
    } finally {
      this.isLoading = false
    }
  }

  private async attemptLoad(): Promise<any> {
    try {
      const confettiModule = await import('canvas-confetti')
      return confettiModule.default || confettiModule
    } catch (error1) {
      try {
        const confettiModule = require('canvas-confetti')
        return confettiModule.default || confettiModule
      } catch (error2) {
        console.warn('All confetti load methods failed:', { error1, error2 })
        throw new Error('Cannot load confetti module')
      }
    }
  }

  async celebrate(options: {
    type?: 'basic' | 'fireworks' | 'burst'
    duration?: number
    particleCount?: number
  } = {}): Promise<boolean> {
    const { type = 'basic', duration = 3000, particleCount = 100 } = options

    try {
      const confetti = await this.loadConfetti()
      if (!confetti || typeof confetti !== 'function') {
        this.showFallbackCelebration(type)
        return false
      }

      switch (type) {
        case 'basic':
          this.basicCelebration(confetti, particleCount)
          break
        case 'fireworks':
          this.fireworksCelebration(confetti, duration)
          break
        case 'burst':
          this.burstCelebration(confetti, particleCount)
          break
      }
      return true
    } catch (error) {
      console.warn('Confetti celebration failed:', error)
      this.showFallbackCelebration(type)
      return false
    }
  }

  private basicCelebration(confetti: any, particleCount: number): void {
    confetti({ particleCount, spread: 70, origin: { y: 0.6 } })
  }

  private fireworksCelebration(confetti: any, duration: number): void {
    const end = Date.now() + duration
    const colors = ['#22c55e', '#f97316', '#3b82f6', '#eab308', '#ec4899']

    const frame = () => {
      if (Date.now() < end) {
        confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0, y: 0.8 }, colors })
        confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1, y: 0.8 }, colors })
        if (Math.random() > 0.7) {
          confetti({ particleCount: 5, angle: 90, spread: 60, origin: { x: 0.5, y: 0.7 }, colors })
        }
        requestAnimationFrame(frame)
      }
    }
    frame()
  }

  private burstCelebration(confetti: any, particleCount: number): void {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        confetti({
          particleCount: particleCount / 3,
          spread: 60,
          origin: { x: 0.3 + (i * 0.2), y: 0.5 + (Math.random() * 0.3) }
        })
      }, i * 200)
    }
  }

  private showFallbackCelebration(type: string): void {
    const celebration = document.createElement('div')
    celebration.style.cssText = `
      position: fixed;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      background: linear-gradient(45deg, #22c55e, #f97316, #3b82f6);
      color: white; padding: 20px 30px;
      border-radius: 15px; font-size: 24px; font-weight: bold;
      text-align: center; z-index: 10000;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      animation: celebrationPulse 2s ease-in-out; pointer-events: none;
    `

    const messages: Record<string, string> = {
      basic: '🎉 讀經完成！',
      fireworks: '🎆 恭喜完成全部聖經！🎆',
      burst: '✨ 太棒了！✨'
    }

    celebration.innerHTML = messages[type] || '🎉 恭喜！'

    if (!document.getElementById('celebration-styles')) {
      const style = document.createElement('style')
      style.id = 'celebration-styles'
      style.textContent = `
        @keyframes celebrationPulse {
          0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
          50% { transform: translate(-50%, -50%) scale(1.1); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
      `
      document.head.appendChild(style)
    }

    document.body.appendChild(celebration)
    setTimeout(() => { if (celebration.parentNode) celebration.parentNode.removeChild(celebration) }, 3000)
  }
}

export const confettiManager = new ConfettiManager()
export const celebrate = (options?: Parameters<typeof confettiManager.celebrate>[0]) =>
  confettiManager.celebrate(options)
