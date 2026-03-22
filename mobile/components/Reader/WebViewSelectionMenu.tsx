import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from '../ui/Icon';

export interface SelectionData {
  text: string;
  x: number;
  y: number;
}

interface WebViewSelectionMenuProps {
  selection: SelectionData;
  onHighlight: (text: string) => void;
  onNote: (text: string) => void;
  onAskGuru: (text: string) => void;
}

const MENU_WIDTH = 210;
const MENU_HEIGHT = 44;

export default function WebViewSelectionMenu({
  selection,
  onHighlight,
  onNote,
  onAskGuru,
}: WebViewSelectionMenuProps) {
  // Position the menu above the selection, centered horizontally
  const menuX = Math.max(8, selection.x - MENU_WIDTH / 2);
  const menuY = Math.max(8, selection.y - MENU_HEIGHT - 12);

  return (
    <View style={[styles.container, { left: menuX, top: menuY }]}>
      <TouchableOpacity
        style={styles.action}
        onPress={() => onHighlight(selection.text)}
        accessibilityLabel="Highlight selection"
      >
        <Icon name="marker" size={16} color="#F59E0B" />
        <Text style={styles.label}>Highlight</Text>
      </TouchableOpacity>

      <View style={styles.divider} />

      <TouchableOpacity
        style={styles.action}
        onPress={() => onNote(selection.text)}
        accessibilityLabel="Add note"
      >
        <Icon name="note-edit-outline" size={16} color="#6366F1" />
        <Text style={styles.label}>Note</Text>
      </TouchableOpacity>

      <View style={styles.divider} />

      <TouchableOpacity
        style={styles.action}
        onPress={() => onAskGuru(selection.text)}
        accessibilityLabel="Ask Guru about selection"
      >
        <Icon name="chat-question-outline" size={16} color="#10B981" />
        <Text style={styles.label}>Ask Guru</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F2937',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 6,
    zIndex: 110,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  label: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
});
