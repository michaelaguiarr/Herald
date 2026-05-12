import { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { AppError } from './app-error'

const HTTP_STATUS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
}

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      statusCode: error.statusCode,
      error: HTTP_STATUS[error.statusCode] ?? 'Error',
      message: error.message,
    })
  }

  if (error instanceof ZodError) {
    const message = error.errors[0]?.message ?? 'Dados inválidos'
    return reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message,
    })
  }

  // Fastify validation errors (JSON Schema)
  if ('statusCode' in error && error.statusCode === 400) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: error.message,
    })
  }

  request.log.error(error)
  return reply.status(500).send({
    statusCode: 500,
    error: 'Internal Server Error',
    message: 'Erro interno no servidor',
  })
}
