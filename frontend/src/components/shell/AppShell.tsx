import { Outlet } from 'react-router-dom'
import TopBar from './TopBar'
import SectionNav from './SectionNav'
import Sidebar from './Sidebar'

export default function AppShell() {
  return (
    <div className="flex flex-col h-screen bg-[#f5f7f8]">
      <TopBar />
      <SectionNav />
      {/* pt-[124px] = 72px TopBar + 52px SectionNav */}
      <div className="flex flex-1 overflow-hidden pt-[124px]">
        <Sidebar />
        {/* ml-[280px] = sidebar width */}
        <main className="flex-1 overflow-y-auto ml-[280px] p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
