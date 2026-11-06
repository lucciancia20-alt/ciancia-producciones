import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart, Camera, Menu, X, Zap } from 'lucide-react';
import { useCart } from '../context/CartContext';

export default function Navbar() {
  const { itemCount } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-dark-900/95 backdrop-blur-md border-b border-dark-600">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-neon-green flex items-center justify-center group-hover:shadow-neon transition-shadow">
              <Camera className="w-5 h-5 text-black" />
            </div>
            <div className="hidden sm:block">
              <div className="font-black text-white text-sm leading-none tracking-wider">CIANCIA</div>
              <div className="text-neon-green text-xs font-bold leading-none tracking-widest">PRODUCCIONES</div>
            </div>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-6">
            <Link to="/" className="text-gray-300 hover:text-neon-green transition-colors font-medium text-sm">
              Álbumes
            </Link>
            <Link to="/admin" className="text-gray-300 hover:text-neon-green transition-colors font-medium text-sm">
              Admin
            </Link>
          </div>

          {/* Cart + hamburger */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/cart')}
              className="relative p-2 text-gray-300 hover:text-neon-green transition-colors"
            >
              <ShoppingCart className="w-6 h-6" />
              {itemCount > 0 && (
                <span className="absolute -top-1 -right-1 badge-neon min-w-[18px] h-[18px] flex items-center justify-center text-[10px]">
                  {itemCount}
                </span>
              )}
            </button>

            {/* Mobile menu button */}
            <button
              className="md:hidden p-2 text-gray-300 hover:text-neon-green transition-colors"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden py-4 border-t border-dark-600 space-y-2">
            <Link
              to="/"
              className="block px-4 py-2 text-gray-300 hover:text-neon-green transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              Álbumes
            </Link>
            <Link
              to="/admin"
              className="block px-4 py-2 text-gray-300 hover:text-neon-green transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              Panel Admin
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}
