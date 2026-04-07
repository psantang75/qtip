import { Navigate } from 'react-router-dom'

// Legacy route — redirect to the active Insights landing page
export default function DashboardPage() {
  return <Navigate to="/app/insights/qc-overview" replace />
}
