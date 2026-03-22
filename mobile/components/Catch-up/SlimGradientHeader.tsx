import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { getIndustryConfig } from '../../constants/industryConfig';
import Icon from '../ui/Icon';

interface SlimGradientHeaderProps {
  industry: string;
  specialization?: string;
  isDark?: boolean;
}

export const SlimGradientHeader: React.FC<SlimGradientHeaderProps> = ({
  industry,
  specialization,
  isDark = false
}) => {
  const config = getIndustryConfig(industry);
  
  const formatLabel = (text: string) => {
    return text
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <View style={[styles.container, { backgroundColor: config.accent }]}>
      <View style={styles.gradientOverlay} />
      <View style={styles.content}>
        <Icon name={config.icon} size={20} color="#FFFFFF" />
        <Text style={styles.industryText}>{formatLabel(industry)}</Text>
        {specialization && (
          <>
            <Text style={styles.separator}>•</Text>
            <Text style={styles.specializationText}>{formatLabel(specialization)}</Text>
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 60,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  gradientOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    ...Platform.select({
      web: {
        background: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)',
      },
    }),
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  industryText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  separator: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  specializationText: {
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.9)',
  },
});
