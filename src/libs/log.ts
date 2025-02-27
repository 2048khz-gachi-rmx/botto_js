import winston from "winston";

const logger = winston.createLogger({
	level: 'info',
	format: winston.format.combine(
		winston.format.splat(),
		winston.format.simple()
	),
	defaultMeta: { service: 'user-service' },
	transports: [
		new winston.transports.File({ filename: 'warn.log', level: 'warn' }),
		new winston.transports.File({ filename: 'combined.log' }),
		new winston.transports.Console()
	],
});

export {
	logger as log
}