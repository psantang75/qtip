import swaggerJSDoc from 'swagger-jsdoc';
import { config } from './environment';

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'QTIP API',
    version: config.APP_VERSION,
    description: 'Quality Training & Insight Platform API Documentation',
    contact: {
      name: 'QTIP Development Team',
      email: 'dev@qtip.com'
    }
  },
  servers: [
    {
      url: `http://localhost:${config.PORT}`,
      description: 'Development server'
    }
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    },
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          username: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role_id: { type: 'integer' },
          role_name: { type: 'string' },
          is_active: { type: 'boolean' }
        }
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              code: { type: 'string' }
            }
          }
        }
      }
    }
  },
  security: [{ BearerAuth: [] }]
};

const options = {
  definition: swaggerDefinition,
  apis: ['./src/routes/*.ts']
};

export const swaggerSpec = swaggerJSDoc(options);
export default swaggerSpec; 