const errorHandler = (error, req, res, next) => {
  const status = error.status || 500;
  const message = error.message || 'Internal server error';
  console.error(`Error: ${message} (Status: ${status})`); // Log error for debugging
  res.status(status).json({ error: message });

};

export default errorHandler;