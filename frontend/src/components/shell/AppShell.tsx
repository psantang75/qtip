import { Outlet } from 'react-router-dom'
import TopBar from './TopBar'
import Sidebar from './Sidebar'

export default function AppShell() {
  return (
    <div className="flex flex-col h-screen bg-[#f5f7f8]">
      <TopBar />
      <div className="flex flex-1 overflow-hidden pt-[72px]">
        <Sidebar />
        <main className="flex-1 overflow-y-auto ml-[280px] p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
