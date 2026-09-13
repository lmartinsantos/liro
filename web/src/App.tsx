import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from '@/lib/theme'
import { BoardPage } from '@/pages/BoardPage'
import { HomePage } from '@/pages/HomePage'
import { JoinPage } from '@/pages/JoinPage'

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/b/:boardId" element={<JoinPage />} />
          <Route path="/b/:boardId/board" element={<BoardPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}
