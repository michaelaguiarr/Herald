import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { Loader2, Mail, Lock, ArrowLeft, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/store/auth.store'
import { login, forgotPassword } from '@/services/auth.service'
import { getApiErrorMessage } from '@/services/api'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
})

const forgotSchema = z.object({
  email: z.string().email('E-mail inválido'),
})

type LoginValues = z.infer<typeof loginSchema>
type ForgotValues = z.infer<typeof forgotSchema>

// ─── Login form ───────────────────────────────────────────────────────────────

function LoginForm({ onForgot }: { onForgot: () => void }) {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [apiError, setApiError] = useState('')

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(values: LoginValues) {
    setApiError('')
    try {
      const data = await login(values.email, values.password)
      setAuth(data.token, data.user)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setApiError(getApiErrorMessage(err))
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>E-mail</FormLabel>
              <FormControl>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="admin@herald.app"
                    className="pl-9"
                    autoComplete="email"
                    {...field}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Senha</FormLabel>
              <FormControl>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder="••••••••"
                    className="pl-9"
                    autoComplete="current-password"
                    {...field}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {apiError && (
          <p className="text-sm font-medium text-destructive">{apiError}</p>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Autenticando…
            </>
          ) : (
            'Entrar'
          )}
        </Button>

        <button
          type="button"
          onClick={onForgot}
          className="w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          Esqueci minha senha
        </button>
      </form>
    </Form>
  )
}

// ─── Forgot password form ─────────────────────────────────────────────────────

function ForgotForm({ onBack }: { onBack: () => void }) {
  const [sent, setSent] = useState(false)
  const [apiError, setApiError] = useState('')

  const form = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(values: ForgotValues) {
    setApiError('')
    try {
      await forgotPassword(values.email)
      setSent(true)
    } catch (err) {
      setApiError(getApiErrorMessage(err))
    }
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <Send className="h-5 w-5 text-green-600" />
        </div>
        <div className="space-y-1">
          <p className="font-medium">E-mail enviado!</p>
          <p className="text-sm text-muted-foreground">
            Verifique sua caixa de entrada e siga as instruções para redefinir sua senha.
          </p>
        </div>
        <Button variant="outline" className="w-full" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Voltar para o login
        </Button>
      </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Informe seu e-mail e enviaremos as instruções para redefinir sua senha.
        </p>

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>E-mail</FormLabel>
              <FormControl>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="admin@herald.app"
                    className="pl-9"
                    autoComplete="email"
                    {...field}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {apiError && (
          <p className="text-sm font-medium text-destructive">{apiError}</p>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Enviando…
            </>
          ) : (
            'Enviar instruções'
          )}
        </Button>

        <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Voltar para o login
        </Button>
      </form>
    </Form>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const [view, setView] = useState<'login' | 'forgot'>('login')

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="text-4xl">📨</div>
          <h1 className="text-2xl font-bold text-primary">Herald</h1>
          <p className="text-sm text-muted-foreground">Dashboard de Notificações</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">
              {view === 'login' ? 'Entrar na conta' : 'Recuperar senha'}
            </CardTitle>
            <CardDescription>
              {view === 'login'
                ? 'Informe suas credenciais para acessar o painel'
                : 'Enviaremos um link de recuperação para seu e-mail'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {view === 'login' ? (
              <LoginForm onForgot={() => setView('forgot')} />
            ) : (
              <ForgotForm onBack={() => setView('login')} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
