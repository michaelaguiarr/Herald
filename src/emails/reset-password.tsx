import * as React from 'react'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

interface ResetPasswordEmailProps {
  name: string
  resetUrl: string
}

export function ResetPasswordEmail({ name, resetUrl }: ResetPasswordEmailProps) {
  return (
    <Html lang="pt-BR">
      <Head />
      <Preview>Redefinição de senha da sua conta Herald</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>

          <Section style={styles.header}>
            <Heading style={styles.logo}>Herald 📬</Heading>
          </Section>

          <Section style={styles.content}>
            <Heading style={styles.h1}>Olá, {name}!</Heading>

            <Text style={styles.text}>
              Recebemos uma solicitação para redefinir a senha da sua conta Herald.
              Clique no botão abaixo para criar uma nova senha.
            </Text>

            <Section style={styles.buttonContainer}>
              <Button style={styles.button} href={resetUrl}>
                Redefinir minha senha
              </Button>
            </Section>

            <Text style={styles.textSmall}>
              Ou copie e cole o link abaixo no seu navegador:
            </Text>
            <Link href={resetUrl} style={styles.link}>
              {resetUrl}
            </Link>

            <Hr style={styles.hr} />

            <Text style={styles.warning}>
              ⚠️ Este link expira em 1 hora.
            </Text>

            <Text style={styles.textMuted}>
              Se você não solicitou a redefinição de senha, ignore este email com segurança.
              Sua senha permanece a mesma.
            </Text>
          </Section>

          <Section style={styles.footer}>
            <Text style={styles.footerText}>
              Herald © {new Date().getFullYear()}
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  )
}

const styles = {
  body: {
    backgroundColor: '#f4f4f5',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    margin: '0',
    padding: '40px 0',
  },
  container: {
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    margin: '0 auto',
    maxWidth: '520px',
    overflow: 'hidden',
  },
  header: {
    backgroundColor: '#1d4ed8',
    padding: '24px 40px',
    textAlign: 'center' as const,
  },
  logo: {
    color: '#ffffff',
    fontSize: '24px',
    fontWeight: '700',
    margin: '0',
  },
  content: {
    padding: '40px',
  },
  h1: {
    color: '#111827',
    fontSize: '22px',
    fontWeight: '700',
    margin: '0 0 16px',
  },
  text: {
    color: '#374151',
    fontSize: '15px',
    lineHeight: '1.6',
    margin: '0 0 24px',
  },
  textSmall: {
    color: '#374151',
    fontSize: '13px',
    lineHeight: '1.5',
    margin: '16px 0 4px',
  },
  textMuted: {
    color: '#6b7280',
    fontSize: '13px',
    lineHeight: '1.5',
    margin: '0',
  },
  buttonContainer: {
    textAlign: 'center' as const,
    margin: '8px 0 24px',
  },
  button: {
    backgroundColor: '#1d4ed8',
    borderRadius: '6px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '15px',
    fontWeight: '600',
    padding: '12px 32px',
    textDecoration: 'none',
  },
  link: {
    color: '#1d4ed8',
    fontSize: '13px',
    wordBreak: 'break-all' as const,
  },
  hr: {
    borderColor: '#e5e7eb',
    borderTopWidth: '1px',
    margin: '24px 0',
  },
  warning: {
    color: '#92400e',
    fontSize: '13px',
    fontWeight: '600',
    margin: '0 0 12px',
  },
  footer: {
    backgroundColor: '#f9fafb',
    borderTop: '1px solid #e5e7eb',
    padding: '16px 40px',
    textAlign: 'center' as const,
  },
  footerText: {
    color: '#9ca3af',
    fontSize: '12px',
    margin: '0',
  },
}
