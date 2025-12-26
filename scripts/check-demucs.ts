import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { checkDemucsInstalled } from '../lib/demucs'

// Загружаем переменные из .env.local
function loadEnvLocal() {
  const envPath = join(process.cwd(), '.env.local')
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8')
    const lines = content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=')
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim()
          process.env[key.trim()] = value
        }
      }
    }
  }
}

// Загружаем переменные перед проверкой
loadEnvLocal()

async function main() {
  console.log('Checking Demucs installation...\n')

  const isInstalled = await checkDemucsInstalled()

  if (isInstalled) {
    console.log('✅ Demucs is installed and available')
    
    // Проверяем версию через разные команды
    const { exec } = require('child_process')
    const { promisify } = require('util')
    const execAsync = promisify(exec)
    
    const commands = [
      'demucs --version',
      'python -m demucs.separate --version',
      'python3 -m demucs.separate --version'
    ]
    
    for (const cmd of commands) {
      try {
        const { stdout } = await execAsync(cmd)
        console.log(`Version (${cmd}): ${stdout.trim()}`)
        break
      } catch (error) {
        // Пробуем следующую команду
        continue
      }
    }
    
    console.log('\n💡 Tip: Если Demucs установлен в venv, активируйте его:')
    console.log('   .\\venv\\Scripts\\Activate.ps1')
    console.log('   или используйте: python -m demucs.separate')
  } else {
    console.log('❌ Demucs is NOT installed or not found')
    console.log('\nTo install Demucs:')
    console.log('  pip install demucs')
    console.log('  or')
    console.log('  python -m pip install demucs')
    console.log('\n💡 Если установлен в venv, активируйте его:')
    console.log('   .\\venv\\Scripts\\Activate.ps1')
    process.exit(1)
  }
}

main().catch(console.error)

